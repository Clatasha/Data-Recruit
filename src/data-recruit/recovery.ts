/** IndexedDB accommodates imported media beyond localStorage's small quota. */
async function database() {
	return new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open("data-recruit-recovery", 1);
		request.onupgradeneeded = () => request.result.createObjectStore("drafts");
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}
export async function recovery(value?: string | null): Promise<string | null> {
	const db = await database();
	try {
		return await new Promise((resolve, reject) => {
			const transaction = db.transaction("drafts", value === undefined ? "readonly" : "readwrite");
			const store = transaction.objectStore("drafts");
			const request =
				value === undefined
					? store.get("current")
					: value === null
						? store.delete("current")
						: store.put(value, "current");
			transaction.oncomplete = () =>
				resolve(value === undefined ? (request.result ?? null) : value);
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	} finally {
		db.close();
	}
}
