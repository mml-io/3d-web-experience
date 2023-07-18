























  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  public readonly renderer: WebGLRenderer;

  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly fxaaEffect: FXAAEffect;
  private readonly fxaaPass: EffectPass;
  private readonly bloomEffect: BloomEffect;
  private readonly bloomPass: EffectPass;

  private readonly gaussGrainEffect = GaussGrainEffect;
  private readonly gaussGrainPass: ShaderPass;






























    window.addEventListener("resize", () => {
      this.updateProjection();
    });
    this.updateProjection();


  private updateProjection(): void {
    this.width = window.innerWidth;
    this.height = innerHeight;







  public render(time: number): void {








