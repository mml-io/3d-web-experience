










export class Environment extends Group {
  private readonly sky: Sky | null = null;
  private readonly skyParameters = {



  private readonly sunPosition = new Vector3();
  private readonly pmremGenerator: PMREMGenerator | null = null;
  private readonly skyRenderTarget: WebGLRenderTarget | null = null;

  constructor(scene: Scene, renderer: WebGLRenderer) {
    super();













    if (this.skyRenderTarget !== null) {
      this.skyRenderTarget.dispose();
    }


    this.add(this.sky);


