import { processPublicBusinessRecords } from "./directory-records";

self.onmessage = (event) => {
  try {
    const records = Array.isArray(event.data?.records) ? event.data.records : [];
    const options = event.data?.options || {};
    const data = processPublicBusinessRecords(records, options);
    self.postMessage({ success: true, data });
  } catch (error) {
    self.postMessage({
      success: false,
      error: error instanceof Error ? error.message : "Unable to process the directory.",
    });
  }
};
