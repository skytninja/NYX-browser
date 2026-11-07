// A small JSON list in the profile (trash, snoozed tabs). Changes run one after another,
// so two quick edits can't overwrite each other. `clean` drops malformed or outdated items.

export function listFile(name, clean) {
  const path = () => PathUtils.join(PathUtils.profileDir, name);
  let queue = Promise.resolve();

  async function read() {
    try {
      const raw = await IOUtils.readJSON(path());
      return Array.isArray(raw) ? clean(raw) : [];
    } catch (error) {
      if (error.name !== "NotFoundError") console.error(`NYX: ${name} unreadable`, error);
      return [];
    }
  }

  return {
    // task(items) returns { items, result }: the new list to write (or undefined to keep it) and the result.
    change(task) {
      const run = queue.then(async () => {
        const { items, result } = await task(await read());
        if (items) await IOUtils.writeJSON(path(), items, { tmpPath: `${path()}.tmp` });
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },

    list() {
      return this.change(items => ({ result: items }));
    },
  };
}

export const WEB_URL = /^https?:\/\//;
