import { EventHandlerCollection } from "./EventHandlerCollection";
import { VirtualJoystick } from "./VirtualJoystick";

enum Key {
  W = "w",
  A = "a",
  S = "s",
  D = "d",
  SHIFT = "shift",
  SPACE = " ",
}

export class KeyInputManager {
  private keys = new Map<string, boolean>();
  private eventHandlerCollection = new EventHandlerCollection();
  private directionJoystick: VirtualJoystick | null = null;

  constructor(private shouldCaptureKeyPress: () => boolean = () => true) {
    this.eventHandlerCollection.add(document, "keydown", this.onKeyDown.bind(this));
    this.eventHandlerCollection.add(document, "keyup", this.onKeyUp.bind(this));
    this.eventHandlerCollection.add(window, "blur", this.handleUnfocus.bind(this));
    this.directionJoystick = new VirtualJoystick({
      radius: 70,
      inner_radius: 20,
      x: 70,
      y: 0,
      mouse_support: false,
    });
  }

  private handleUnfocus(_event: FocusEvent): void {
    this.keys.clear();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.shouldCaptureKeyPress()) {
      if (event.key.length === 2 && event.key[0] === "F") {
        // Ignore all Function keys
        return;
      }
      if (event.metaKey) {
        // Ignore all meta keys (e.g. Alt, Cmd)
        return;
      }
      this.keys.set(event.key.toLowerCase(), true);
      event.preventDefault();
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    this.keys.set(event.key.toLowerCase(), false);
  }

  public isKeyPressed(key: string): boolean {
    return this.keys.get(key) || false;
  }

  public isMovementKeyPressed(): boolean {
    return (
      [Key.W, Key.A, Key.S, Key.D].some((key) => this.isKeyPressed(key)) ||
      this.directionJoystick!.hasDirection
    );
  }

  get forward(): boolean {
    return this.isKeyPressed(Key.W) || this.directionJoystick!.up;
  }

  get backward(): boolean {
    return this.isKeyPressed(Key.S) || this.directionJoystick!.down;
  }

  get left(): boolean {
    return this.isKeyPressed(Key.A) || this.directionJoystick!.left;
  }

  get right(): boolean {
    return this.isKeyPressed(Key.D) || this.directionJoystick!.right;
  }

  get run(): boolean {
    return this.isKeyPressed(Key.SHIFT);
  }

  get jump(): boolean {
    return this.isKeyPressed(Key.SPACE);
  }

  get anyDirection(): boolean {
    return this.isMovementKeyPressed();
  }

  get conflictingDirection(): boolean {
    return (
      (this.isKeyPressed(Key.W) && this.isKeyPressed(Key.S)) ||
      (this.isKeyPressed(Key.A) && this.isKeyPressed(Key.D))
    );
  }

  public dispose() {
    this.eventHandlerCollection.clear();
  }
}
