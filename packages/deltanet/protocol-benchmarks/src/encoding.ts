import {
  BufferWriter,
  encodeServerMessage,
  encodeServerMessageV02,
} from "@mml-io/delta-net-protocol";
import Benchmark from "benchmark";

import { prepareData } from "./prepare-data";

export function runEncodingBenchmark(): Promise<void> {
  return new Promise((resolve, reject) => {
    let totalV01Length = 0;
    let totalV02Length = 0;
    let totalJSONLength = 0;

    const data = prepareData(1000);
    const jsonData = prepareData(1000, true);
    const suite = new Benchmark.Suite();
    suite
      .add("Binary v0.1", function () {
        let totalLength = 0;
        for (const message of data) {
          const writer = new BufferWriter(256);
          encodeServerMessage(message, writer);
          const encoded = writer.getBuffer();
          totalLength += encoded.length;
        }
        if (totalLength <= 0) {
          throw new Error("Invalid total length");
        }
        totalV01Length = totalLength;
      })
      .add("Binary v0.2", function () {
        let totalLength = 0;
        for (const message of data) {
          const writer = new BufferWriter(256);
          encodeServerMessageV02(message, writer);
          const encoded = writer.getBuffer();
          totalLength += encoded.length;
        }
        if (totalLength <= 0) {
          throw new Error("Invalid total length");
        }
        totalV02Length = totalLength;
      })
      .add("JSON", function () {
        let totalLength = 0;
        for (const message of jsonData) {
          const encoded = JSON.stringify(message);
          totalLength += encoded.length;
        }
        if (totalLength <= 0) {
          throw new Error("Invalid total length");
        }
        totalJSONLength = totalLength;
      })
      // add listeners
      .on("cycle", (event: Benchmark.Event) => {
        console.log(String(event.target));
      })
      .on("complete", () => {
        console.log(`Fastest is ${suite.filter("fastest").map("name")}`);

        console.log(`Binary v0.1 byte length : ${totalV01Length}`);
        console.log(`Binary v0.2 byte length : ${totalV02Length}`);
        console.log(`JSON byte length        : ${totalJSONLength}`);
        console.log(`v0.2 is ${(totalV02Length / totalV01Length).toFixed(4)}x the size of v0.1`);
        console.log(`v0.1 is ${(totalV01Length / totalJSONLength).toFixed(4)}x the size of JSON`);
        console.log(`v0.2 is ${(totalV02Length / totalJSONLength).toFixed(4)}x the size of JSON`);
        resolve();
      })
      .on("error", (error: Error) => {
        reject(error);
      })
      // run async
      .run({ async: true });
  });
}
