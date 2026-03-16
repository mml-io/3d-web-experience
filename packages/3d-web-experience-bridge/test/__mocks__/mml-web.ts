// Stub for @mml-io/mml-web — prevents loading DOM-dependent code in Node.js tests.
// Must export everything that any transitive import chain needs.

export class MMLCollisionTrigger {
  static init() {
    return {
      update: () => {},
      dispose: () => {},
      setCurrentCollisions: () => {},
    };
  }
}

export class MElement {
  static getMElementFromObject(_obj: any): any {
    return null;
  }
}

export class LoadingProgressManager {
  loadingAssets: Map<unknown, { type: string; assetUrl: string }> = new Map();
  loadingDocuments: Map<unknown, unknown> = new Map();
  summary = { totalLoaded: 0, totalToLoad: 0, totalErrored: 0 };
  initialLoad = false;
  addProgressCallback(_cb: (...args: Array<unknown>) => void) {}
  removeProgressCallback(_cb: (...args: Array<unknown>) => void) {}
  setInitialLoad(_result?: unknown) {}
  toRatio(): [number, boolean] {
    return [1, true];
  }
  toSummary() {
    return {};
  }
  static LoadingProgressSummaryToString(_summary: any): string {
    return "";
  }
  addLoadingAsset(_ref: unknown, _url: string, _type: string) {}
  completedLoadingAsset(_ref: unknown) {}
  errorLoadingAsset(_ref: unknown, _err: Error) {}
  addLoadingDocument(_ref: unknown, _url: string, _mgr: LoadingProgressManager) {}
  disposeOfLoadingAsset(_ref: unknown) {}
  updateDocumentProgress(_ref: unknown) {}
  removeLoadingDocument(_ref: unknown) {}
}

export class MMLNetworkSource {
  static create(_opts: any): MMLNetworkSource {
    return new MMLNetworkSource();
  }
  dispose() {}
}

export class MMLDocumentTimeManager {
  getDocumentTime() {
    return 0;
  }
  tick() {}
}

export type PositionAndRotation = {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
};

export type IMMLScene = any;

export function setGlobalMMLScene() {}
export function setGlobalDocumentTimeManager() {}
export function registerCustomElementsToWindow() {}
export function registerCustomElementsToVirtualDocument() {}
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

// Virtual DOM stubs
export class VirtualNode {
  nodeName = "";
  ownerDocument: any = null;
  private _childNodes: VirtualNode[] = [];
  private _parentNode: VirtualNode | null = null;
  private _isConnected = false;
  private _rootConnected = false;

  constructor(nodeName: string = "") {
    this.nodeName = nodeName;
  }

  get parentNode() {
    return this._parentNode;
  }
  get parentElement() {
    return this._parentNode;
  }
  get childNodes() {
    return this._childNodes;
  }
  get children() {
    return this._childNodes.filter((c) => c instanceof VirtualHTMLElement);
  }
  get firstChild() {
    return this._childNodes[0] ?? null;
  }
  get isConnected() {
    return this._isConnected;
  }
  get textContent(): string | null {
    return this._childNodes.map((c) => c.textContent ?? "").join("");
  }

  setRootConnected(connected: boolean) {
    this._rootConnected = connected;
    this._updateConnected(connected);
  }

  private _updateConnected(connected: boolean) {
    this._isConnected = connected;
    for (const child of this._childNodes) {
      (child as any)._updateConnected(connected);
    }
  }

  appendChild(child: VirtualNode): VirtualNode {
    if (child._parentNode) {
      child._parentNode.removeChild(child);
    }
    child._parentNode = this;
    child.ownerDocument = child.ownerDocument ?? this.ownerDocument;
    this._childNodes.push(child);
    if (this._isConnected || this._rootConnected) {
      (child as any)._updateConnected(true);
    }
    return child;
  }

  insertBefore(newNode: VirtualNode, _refNode: VirtualNode | null): VirtualNode {
    return this.appendChild(newNode);
  }

  removeChild(child: VirtualNode): VirtualNode {
    const idx = this._childNodes.indexOf(child);
    if (idx !== -1) this._childNodes.splice(idx, 1);
    child._parentNode = null;
    (child as any)._updateConnected(false);
    return child;
  }

  replaceChild(newChild: VirtualNode, oldChild: VirtualNode): VirtualNode {
    this.removeChild(oldChild);
    this.appendChild(newChild);
    return oldChild;
  }

  remove() {
    if (this._parentNode) this._parentNode.removeChild(this);
  }

  append(...nodes: VirtualNode[]) {
    for (const n of nodes) this.appendChild(n);
  }
  prepend(...nodes: VirtualNode[]) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n._parentNode) {
        n._parentNode.removeChild(n);
      }
      n._parentNode = this;
      n.ownerDocument = n.ownerDocument ?? this.ownerDocument;
      this._childNodes.unshift(n);
      if (this._isConnected || this._rootConnected) {
        (n as any)._updateConnected(true);
      }
    }
  }
}

export class VirtualHTMLElement extends VirtualNode {
  private _attributes = new Map<string, string>();
  style: any = {};

  get tagName() {
    return this.nodeName;
  }
  get id() {
    return this.getAttribute("id") ?? "";
  }

  getAttribute(name: string): string | null {
    return this._attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this._attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this._attributes.delete(name);
  }
  hasAttribute(name: string) {
    return this._attributes.has(name);
  }
  getAttributeNames() {
    return Array.from(this._attributes.keys());
  }
  get attributes() {
    return Array.from(this._attributes.entries()).map(([name, value]) => ({ name, value }));
  }

  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }

  querySelector(_selector: string): VirtualHTMLElement | null {
    const results = this.querySelectorAll(_selector);
    return results[0] ?? null;
  }

  querySelectorAll(_selector: string): VirtualHTMLElement[] {
    // Supports bare tag names (e.g. "m-cube") and optional attribute selectors
    // e.g. m-model[class*="table"]
    const match = _selector.match(/^([a-z0-9-]+)(?:\[([a-z]+)\*="([^"]+)"\])?$/i);
    const tag = match ? match[1].toUpperCase() : _selector.toUpperCase();
    const attrName = match?.[2] ?? null;
    const attrContains = match?.[3] ?? null;

    const results: VirtualHTMLElement[] = [];
    const walk = (node: VirtualNode) => {
      for (const child of node.childNodes) {
        if (child instanceof VirtualHTMLElement) {
          if (child.nodeName === tag) {
            if (attrName && attrContains) {
              const val = child.getAttribute(attrName);
              if (val && val.includes(attrContains)) results.push(child);
            } else {
              results.push(child);
            }
          }
          walk(child);
        }
      }
    };
    walk(this);
    return results;
  }

  private _innerHTML = "";
  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(v: string) {
    this._innerHTML = v;
    if (v === "") {
      for (const child of [...this.childNodes]) {
        this.removeChild(child);
      }
    }
  }
  get outerHTML() {
    return "";
  }

  connectedCallback() {}
  disconnectedCallback() {}
  attributeChangedCallback(_name: string, _oldValue: string | null, _newValue: string | null) {}
}

export class VirtualDocument {
  defaultView = null;
  private registry = new Map<string, new () => VirtualHTMLElement>();

  registerElement(tagName: string, constructor: new () => VirtualHTMLElement) {
    this.registry.set(tagName.toLowerCase(), constructor);
  }

  createElement(tagName: string): VirtualHTMLElement {
    const Ctor = this.registry.get(tagName.toLowerCase());
    const el = Ctor ? new Ctor() : new VirtualHTMLElement();
    el.nodeName = tagName.toUpperCase();
    el.ownerDocument = this;
    return el;
  }

  createTextNode(_text: string) {
    const node = new VirtualNode("#text");
    node.ownerDocument = this;
    return node;
  }

  createDocumentFragment() {
    const frag = new VirtualNode("#document-fragment");
    frag.ownerDocument = this;
    return frag;
  }
}

export class VirtualEvent {
  type: string;
  bubbles: boolean;
  target: any = null;
  currentTarget: any = null;
  constructor(type: string, init?: { bubbles?: boolean }) {
    this.type = type;
    this.bubbles = init?.bubbles ?? false;
  }
  preventDefault() {}
  stopPropagation() {}
  stopImmediatePropagation() {}
}

export class VirtualCustomEvent<T = any> extends VirtualEvent {
  detail: T;
  constructor(type: string, init?: { bubbles?: boolean; detail?: T }) {
    super(type, init);
    this.detail = init?.detail as T;
  }
}
