import {
  BufferReader,
  decodeClientMessages,
  DeltaNetClientMessage,
  DeltaNetServerErrorType,
  DeltaNetServerErrors,
  DeltaNetServerMessage,
  deltaNetProtocolSubProtocol_v0_1,
  deltaNetProtocolSubProtocol_v0_2,
} from "@mml-io/delta-net-protocol";

import { DeltaNetServer, DeltaNetServerError } from "./DeltaNetServer";

export abstract class DeltaNetConnection {
  public abstract readonly protocolVersion:
    | typeof deltaNetProtocolSubProtocol_v0_1
    | typeof deltaNetProtocolSubProtocol_v0_2;

  private websocketListener: (messageEvent: MessageEvent) => void;

  public readonly internalConnectionId: number;
  public isObserver: boolean = false; // Track observer mode

  // Pending state for new joiners (before they're authenticated)
  public readonly components = new Map<number, bigint>();
  public readonly states = new Map<number, Uint8Array>();

  // Track pending async state validations per state
  private pendingStateValidations = new Map<
    number,
    { validationId: number; abortController: AbortController }
  >();
  private nextValidationId = 1;

  // Track authentication state
  private authState: "pending" | "authenticating" | "authenticated" | "failed" = "pending";
  private authenticationAbortController: AbortController | null = null;

  public constructor(
    public readonly webSocket: WebSocket,
    protected readonly deltaNetServer: DeltaNetServer,
  ) {
    // Get connection ID immediately upon creation
    this.internalConnectionId = deltaNetServer.getNextConnectionId();

    this.websocketListener = (messageEvent: MessageEvent) => {
      const buffer = new Uint8Array(messageEvent.data as ArrayBuffer);

      // Check message size before attempting to decode
      const maxMessageSize = this.deltaNetServer.getMaxMessageSize();
      if (buffer.length > maxMessageSize) {
        this.disconnectWithError(
          new Error(
            `Message size ${buffer.length} bytes exceeds maximum allowed size of ${maxMessageSize} bytes`,
          ),
          DeltaNetServerErrors.USER_NETWORKING_UNKNOWN_ERROR_TYPE,
          false,
        );
        return;
      }

      try {
        const messages = decodeClientMessages(new BufferReader(buffer));
        for (const parsed of messages) {
          this.handleClientMessage(parsed);
        }
      } catch (error) {
        this.disconnectWithError(
          new Error(
            `Failed to decode client messages: ${error instanceof Error ? error.message : error}`,
          ),
          DeltaNetServerErrors.USER_NETWORKING_UNKNOWN_ERROR_TYPE,
          false,
        );
        return;
      }
    };
    webSocket.addEventListener("message", this.websocketListener);
  }

  public abstract sendMessage(message: DeltaNetServerMessage): boolean;

  public sendEncodedBytes(bytes: Uint8Array): boolean {
    if (this.webSocket.readyState !== 1 /* WebSocket.OPEN */) {
      return false;
    }
    this.webSocket.send(bytes);
    return true;
  }

  public dispose() {
    this.webSocket.removeEventListener("message", this.websocketListener);
    // Cancel all pending validations
    for (const { abortController } of this.pendingStateValidations.values()) {
      abortController.abort();
    }
    this.pendingStateValidations.clear();

    // Cancel pending authentication
    if (this.authenticationAbortController) {
      this.authenticationAbortController.abort();
      this.authenticationAbortController = null;
    }
  }

  public setAuthenticated() {
    this.authState = "authenticated";
  }

  public disconnectWithError(
    error: Error,
    errorType: DeltaNetServerErrorType,
    retryable: boolean = true,
  ): void {
    try {
      this.sendMessage({
        type: "error",
        errorType,
        message: error.message,
        retryable,
      });
    } catch (sendError) {
      console.warn("Failed to send error message to client:", sendError);
    }

    try {
      // WebSocket spec limits close reason to 123 bytes of UTF-8.
      // Use encodeInto to truncate in a single pass without repeated allocations.
      const encoder = new TextEncoder();
      const buf = new Uint8Array(123);
      const { written } = encoder.encodeInto(error.message, buf);
      const reason = new TextDecoder().decode(buf.subarray(0, written));
      this.webSocket.close(1008, reason);
    } catch (closeError) {
      console.warn("Failed to close websocket connection:", closeError);
    }

    // Immediately clean up internal data structures to prevent memory leaks.
    // This ensures cleanup happens even if the WebSocket close event doesn't fire.
    this.deltaNetServer.removeWebSocket(this.webSocket);
  }

  private async handleConnectUser(
    token: string,
    observer: boolean,
    components: Array<[number, bigint]>,
    states: Array<[number, Uint8Array]>,
  ): Promise<void> {
    // Reject if already authenticated, currently authenticating, or previously failed
    if (this.authState === "authenticated") {
      this.disconnectWithError(
        new Error("User is already authenticated"),
        DeltaNetServerErrors.USER_ALREADY_AUTHENTICATED_ERROR_TYPE,
        false,
      );
      return;
    }

    if (this.authState === "authenticating") {
      this.disconnectWithError(
        new Error("Authentication already in progress"),
        DeltaNetServerErrors.AUTHENTICATION_IN_PROGRESS_ERROR_TYPE,
        false,
      );
      return;
    }

    if (this.authState === "failed") {
      this.disconnectWithError(
        new Error("Authentication has already failed for this connection"),
        DeltaNetServerErrors.USER_NETWORKING_UNKNOWN_ERROR_TYPE,
        false,
      );
      return;
    }

    this.authState = "authenticating";
    this.authenticationAbortController = new AbortController();

    // Set observer mode
    this.isObserver = observer;

    // Store the pending data
    this.components.clear();
    for (const [id, value] of components) {
      this.components.set(id, value);
    }
    this.states.clear();
    for (const [id, value] of states) {
      this.states.set(id, value);
    }

    let result:
      | { success: boolean; error?: string; stateOverrides?: Array<[number, Uint8Array]> }
      | DeltaNetServerError
      | Error;
    try {
      const rawResult = this.deltaNetServer.validateJoiner(this, token, components, states);
      if (rawResult instanceof Promise) {
        result = await rawResult;

        // Check if authentication was canceled while we were waiting
        if (this.authenticationAbortController?.signal.aborted) {
          // Authentication was canceled (connection disposed), silently return
          return;
        }

        // Check if connection is still tracked by the server
        if (!this.deltaNetServer.hasWebSocket(this.webSocket)) {
          // Connection was removed while authentication was pending, silently return
          return;
        }
      } else {
        result = rawResult;
      }
    } catch (error) {
      // Check if authentication was canceled
      if (this.authenticationAbortController?.signal.aborted) {
        return;
      }
      result = error instanceof Error ? error : new Error(String(error));
    }

    // Clear the abort controller since authentication is complete
    this.authenticationAbortController = null;

    if (result instanceof DeltaNetServerError) {
      this.authState = "failed";
      this.disconnectWithError(result, result.errorType, result.retryable);
    } else if (result instanceof Error) {
      this.authState = "failed";
      this.disconnectWithError(
        result,
        DeltaNetServerErrors.USER_NETWORKING_UNKNOWN_ERROR_TYPE,
        false,
      );
    } else if (typeof result !== "object") {
      this.authState = "failed";
      this.disconnectWithError(
        new Error("Invalid authentication result"),
        DeltaNetServerErrors.USER_NETWORKING_UNKNOWN_ERROR_TYPE,
        false,
      );
    } else {
      if (result.success) {
        // Apply state overrides if provided
        if (result.stateOverrides) {
          for (const [stateId, stateValue] of result.stateOverrides) {
            this.states.set(stateId, stateValue);
          }
        }

        this.deltaNetServer.addAuthenticatedConnection(this);
      } else {
        this.authState = "failed";
        this.disconnectWithError(
          new Error(result.error || "Authentication failed"),
          DeltaNetServerErrors.USER_NETWORKING_UNKNOWN_ERROR_TYPE,
          false,
        );
      }
    }
  }

  private async handleStateUpdate(stateId: number, stateValue: Uint8Array): Promise<void> {
    if (this.authState !== "authenticated") {
      console.error("State update received before authentication completed");
      return;
    }

    // Cancel any existing pending validation for this state
    const existingValidation = this.pendingStateValidations.get(stateId);
    if (existingValidation) {
      existingValidation.abortController.abort();
      this.pendingStateValidations.delete(stateId);
    }

    const abortController = new AbortController();

    const result = this.deltaNetServer.validateAndApplyStateUpdate(
      this,
      this.internalConnectionId,
      stateId,
      stateValue,
      abortController.signal,
    );

    if (result instanceof Promise) {
      const validationId = this.nextValidationId++;
      this.pendingStateValidations.set(stateId, { validationId, abortController });

      try {
        const asyncResult = await result;

        // Check if this validation is still current
        const currentValidation = this.pendingStateValidations.get(stateId);
        if (!currentValidation || currentValidation.validationId !== validationId) {
          return; // Validation was superseded
        }

        this.pendingStateValidations.delete(stateId);

        if (asyncResult instanceof DeltaNetServerError) {
          this.disconnectWithError(asyncResult, asyncResult.errorType, asyncResult.retryable);
          return;
        }
        if (asyncResult instanceof Error) {
          this.disconnectWithError(
            asyncResult,
            DeltaNetServerErrors.USER_NETWORKING_UNKNOWN_ERROR_TYPE,
            false,
          );
          return;
        }

        return;
      } catch (error) {
        // Check if validation is still current
        const currentValidation = this.pendingStateValidations.get(stateId);
        if (currentValidation && currentValidation.validationId === validationId) {
          this.pendingStateValidations.delete(stateId);

          if (error instanceof DeltaNetServerError) {
            this.disconnectWithError(error, error.errorType, error.retryable);
          } else if (error instanceof Error) {
            this.disconnectWithError(
              error,
              DeltaNetServerErrors.USER_NETWORKING_UNKNOWN_ERROR_TYPE,
              false,
            );
          } else {
            this.disconnectWithError(
              new Error("State validation failed"),
              DeltaNetServerErrors.USER_NETWORKING_UNKNOWN_ERROR_TYPE,
              false,
            );
          }
        }
        return;
      }
    } else {
      // Synchronous result
      if (result instanceof DeltaNetServerError) {
        this.disconnectWithError(result, result.errorType, result.retryable);
        return;
      }
      if (result instanceof Error) {
        this.disconnectWithError(
          result,
          DeltaNetServerErrors.USER_NETWORKING_UNKNOWN_ERROR_TYPE,
          false,
        );
        return;
      }
      return;
    }
  }

  private handleClientMessage(parsed: DeltaNetClientMessage) {
    switch (parsed.type) {
      case "connectUser": {
        this.handleConnectUser(
          parsed.token,
          parsed.observer,
          parsed.components,
          parsed.states,
        ).catch((error) => {
          console.error("Unhandled error in handleConnectUser:", error);
        });
        return;
      }
      case "pong":
        // Ignore pongs
        return;
      case "setUserComponents": {
        if (this.authState !== "authenticated") {
          try {
            this.sendMessage({
              type: "error",
              errorType: DeltaNetServerErrors.USER_NOT_AUTHENTICATED_ERROR_TYPE,
              message: `Event sent, but user has not been authenticated yet.`,
              retryable: false,
            });
          } catch {
            // WebSocket may already be closed
          }
          console.error("Event sent, but user has not been authenticated yet.");
          this.webSocket.close(1000, "User has not been authenticated yet");
          return;
        }

        // Handle component updates immediately
        const result = this.deltaNetServer.setUserComponents(
          this,
          this.internalConnectionId,
          parsed.components,
        );

        // Check if component update was rejected
        if (!result.success) {
          this.disconnectWithError(
            new Error(result.error),
            DeltaNetServerErrors.USER_NETWORKING_UNKNOWN_ERROR_TYPE,
            true,
          );
          return;
        }

        // Handle state updates individually with async validation
        for (const [stateId, stateValue] of parsed.states) {
          this.handleStateUpdate(stateId, stateValue).catch((error) => {
            console.error("Unhandled error in handleStateUpdate:", error);
          });
        }
        return;
      }
      case "clientCustom": {
        if (this.authState !== "authenticated") {
          try {
            this.sendMessage({
              type: "error",
              errorType: DeltaNetServerErrors.USER_NOT_AUTHENTICATED_ERROR_TYPE,
              message: `Custom message sent, but user has not been authenticated yet.`,
              retryable: false,
            });
          } catch {
            // WebSocket may already be closed
          }
          console.error("Custom message sent, but user has not been authenticated yet.");
          this.webSocket.close(1000, "User has not been authenticated yet");
          return;
        }

        // Handle custom message
        this.deltaNetServer.handleCustomMessage(
          this,
          this.internalConnectionId,
          parsed.customType,
          parsed.contents,
        );
        return;
      }
      default:
        console.error("Unknown message type from client", parsed);
    }
  }
}
