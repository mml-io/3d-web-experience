import {
  BufferReader,
  BufferWriter,
  DeltaNetServerMessage,
  encodeServerMessage,
  encodeServerMessageV02,
  decodeServerMessages,
  decodeServerMessagesV02,
} from "@mml-io/delta-net-protocol";
import Benchmark from "benchmark";

import { prepareData } from "./prepare-data";

export function runDecodingBenchmark(): Promise<void> {
  return new Promise((resolve, reject) => {
    const data = prepareData(1000);
    const jsonData = prepareData(1000, true);

    const encodedV01Data = data.map((message) => {
      const writer = new BufferWriter(256);
      encodeServerMessage(message, writer);
      return writer.getBuffer();
    });
    const encodedV02Data = data.map((message) => {
      const writer = new BufferWriter(256);
      encodeServerMessageV02(message, writer);
      return writer.getBuffer();
    });
    const encodedJSON = jsonData.map((message) => JSON.stringify(message));

    const suite = new Benchmark.Suite();
    suite
      .add("Binary v0.1", function () {
        let totalLength = 0;
        for (const message of encodedV01Data) {
          const bufferReader = new BufferReader(message);
          const decoded = decodeServerMessages(bufferReader);
          totalLength += (decoded[0] as DeltaNetServerMessage).type.length;
        }
        if (totalLength <= 0) {
          throw new Error("Invalid total length");
        }
      })
      .add("Binary v0.2", function () {
        let totalLength = 0;
        for (const message of encodedV02Data) {
          const bufferReader = new BufferReader(message);
          const decoded = decodeServerMessagesV02(bufferReader);
          totalLength += (decoded[0] as DeltaNetServerMessage).type.length;
        }
        if (totalLength <= 0) {
          throw new Error("Invalid total length");
        }
      })
      .add("JSON", function () {
        let totalLength = 0;
        for (const message of encodedJSON) {
          const decoded = JSON.parse(message);
          totalLength += decoded.type.length;
        }
        if (totalLength <= 0) {
          throw new Error("Invalid total length");
        }
      })
      // add listeners
      .on("cycle", (event: Benchmark.Event) => {
        console.log(String(event.target));
      })
      .on("complete", () => {
        console.log(`Fastest is ${suite.filter("fastest").map("name")}`);
        resolve();
      })
      .on("error", (error: Error) => {
        reject(error);
      })
      // run async
      .run({ async: true });
  });
}
