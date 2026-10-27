export type DraftFile = { file: File; id: string };
let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  return (database ||= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("flakflak-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = undefined;
      reject(request.error);
    };
  }));
}
export async function readDraftFiles(key: string): Promise<DraftFile[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("files").objectStore("files").get(key);
    request.onsuccess = () =>
      resolve(
        (request.result || []).map(
          (item: {
            id: string;
            bytes?: ArrayBuffer;
            blob?: Blob;
            file?: File;
            name?: string;
            type?: string;
            lastModified?: number;
          }) => ({
            id: item.id,
            file: new File(
              [item.bytes || item.blob || item.file!],
              item.name || item.file?.name || "attachment",
              {
                type:
                  item.type ||
                  item.file?.type ||
                  item.blob?.type ||
                  "application/octet-stream",
                lastModified:
                  item.lastModified || item.file?.lastModified || Date.now(),
              },
            ),
          }),
        ),
      );
    request.onerror = () => reject(request.error);
  });
}
export async function writeDraftFiles(key: string, files: DraftFile[]) {
  // Store bytes and explicit metadata: WebKit can reject File/Blob structured clones.
  const records = await Promise.all(
    files.map(async ({ file, id }) => ({
      id,
      bytes: await file.arrayBuffer(),
      name: file.name,
      type: file.type,
      lastModified: file.lastModified,
    })),
  );
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("files", "readwrite"),
      store = transaction.objectStore("files");
    if (records.length) store.put(records, key);
    else store.delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function clearDraftFiles(prefix: string) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("files", "readwrite"),
      request = tx.objectStore("files").openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (String(cursor.key).startsWith(prefix)) cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
