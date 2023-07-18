

export class RunTimeManager {



  private fpsUpdateTime: number = 0;
  private framesSinceLastFPSUpdate: number = 0;





  public fps: number = 0;












    if (this.deltaTimeBuffer.length > this.bufferSize) {
      this.deltaTimeBuffer.shift();
    }



    this.framesSinceLastFPSUpdate++;
    if (this.framesSinceLastFPSUpdate >= this.bufferSize) {
      this.fps =
        Math.round((this.framesSinceLastFPSUpdate / (this.time - this.fpsUpdateTime)) * 100) / 100;
      this.fpsUpdateTime = this.time;
      this.framesSinceLastFPSUpdate = 0;
    }


