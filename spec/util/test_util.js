/* eslint-env node, browser */

const CHUNK_SIZE = 1024;
const encoder = new TextEncoder();

function streamFactory (targetSize, seed = 1) {
  let count = 0;

  const stream = new ReadableStream({
    type: 'bytes',
    autoAllocateChunkSize: CHUNK_SIZE,
    pull (controller) {
      if (controller.byobRequest) {
        const numRemaining = targetSize - count;
        const view = controller.byobRequest.view; // Uint8Array(256)
        const numToWrite = Math.min(view.length, numRemaining);

        encoder.encodeInto(someChars(numToWrite, seed), view);
        count += numToWrite;
        controller.byobRequest.respond(numToWrite);

        if (count >= targetSize) {
          controller.close();
        }
      } else {
        console.log('byobRequest was null');
        const chunkSize = Math.max(controller.desiredSize, CHUNK_SIZE);
        if (targetSize - count > chunkSize) {
          const str = someChars(chunkSize, seed);
          count += str.length;
          controller.enqueue(str);
        } else if (targetSize > count) {
          const str = someChars(targetSize - count, seed);
          count += str.length;
          controller.enqueue(str);
        } else {
          controller.close();
        }
      }
    }
  });
  return stream;
}

const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()';

function someChars (num, seed) {
  let string = charset.charAt(seed % charset.length);

  while (string.length < num) {
    string += ' ' + seed;
  }

  string = string.slice(0, num);
  string[num - 1] = ' ';

  return string;
}

module.exports = { streamFactory };
