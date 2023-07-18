

export class Lights extends Group {
  private readonly ambientLight: AmbientLight;
  private readonly directionalLight: DirectionalLight;

  constructor() {
    super();
















    this.directionalLight.shadow.camera = new OrthographicCamera(











    this.add(this.ambientLight);
    this.add(this.directionalLight);


