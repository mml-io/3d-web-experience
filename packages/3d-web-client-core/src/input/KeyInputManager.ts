import { EventHandlerCollection } from "./EventHandlerCollection";

export class KeyInputManager {
  private keys = new Map<string, boolean>();
  private eventHandlerCollection = new EventHandlerCollection();

  constructor(private shouldCaptureKeyPress: () => boolean = () => true) {
    this.eventHandlerCollection.add(document, "keydown", this.onKeyDown.bind(this));
    this.eventHandlerCollection.add(document, "keyup", this.onKeyUp.bind(this));
    this.eventHandlerCollection.add(window, "blur", this.handleUnfocus.bind(this));
  }

  private handleUnfocus(_event: FocusEvent): void {
    this.keys.clear();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.shouldCaptureKeyPress()) {
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
    return ["w", "a", "s", "d"].some((key) => this.isKeyPressed(key));
  }

  get forward(): boolean {
    return this.isKeyPressed("w");
  }

  get backward(): boolean {
    return this.isKeyPressed("s");
  }

  get left(): boolean {
    return this.isKeyPressed("a");
  }

  get right(): boolean {
    return this.isKeyPressed("d");
  }

  get run(): boolean {
    return this.isKeyPressed("shift");
  }

  get jump(): boolean {
    return this.isKeyPressed(" ");
  }

  get anyDirection(): boolean {
    return this.isMovementKeyPressed();
  }

  get conflictingDirection(): boolean {
    return (
      (this.isKeyPressed("w") && this.isKeyPressed("s")) ||
      (this.isKeyPressed("a") && this.isKeyPressed("d"))
    );
  }

  public dispose() {
    this.eventHandlerCollection.clear();
  }
}
