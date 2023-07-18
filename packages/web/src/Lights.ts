

export class Lights extends Group {
  private readonly ambientLight: AmbientLight;
  private readonly directionalLight: DirectionalLight;

  constructor() {
    super();







    direction
      .subVectors(this.directionalLight.position, this.directionalLight.target.position)
      .normalize();






    this.directionalLight.shadow.camera = new OrthographicCamera(





      scaleFactor * 2,





    this.add(this.ambientLight);
    this.add(this.directionalLight);


