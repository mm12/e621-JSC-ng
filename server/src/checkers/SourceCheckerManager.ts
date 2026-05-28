import fs from 'fs';
import { dirname } from 'path';
import calcPhash from 'sharp-phash';
import { fileURLToPath, pathToFileURL } from 'url';
import type { BaseSourceData, DatabasePost, SourceDataMap, SourceCheckQueueItem, CallbackFunction, Result } from '../../../shared';
import Queue, { Priority } from '../modules/Queue';
import { SourceChecker } from './SourceChecker';
import { Database, E621Handler } from '../modules';

export default class SourceCheckerManager {
  private static queue: Queue<SourceCheckQueueItem> = new Queue();
  private static queueRunning: boolean = false;

  private static sourceCheckers: SourceChecker[] = [];

  static async start() {
    await SourceChecker.initializePuppet();

    const __dirname = dirname(fileURLToPath(import.meta.url));

    const files = fs.readdirSync(`${__dirname}/sites`).filter(file => file.endsWith('.js') || file.endsWith('.ts'));
    for (const file of files) {
      const sourceChecker = (await import(pathToFileURL(`${__dirname}/sites/${file}`).href)).default;
      this.sourceCheckers.push(new sourceChecker() as SourceChecker);
    }

    const queueItems = await Database.getQueue();
    console.log(`[SourceCheckerManager] Starting with ${queueItems.length} posts in queue`);
    this.queue.addMany(queueItems);
    if (this.queue.length > 0) this.queueRoutine();
  }

  static async queueRoutine() {
    try {
      if (!this.queue.hasMoreItems()) {
        this.queueRunning = false;
        return;
      }

      this.queueRunning = true;

      const post = this.queue.pop();
      const data = await this.processPost(post);

      if (post.callbacks && post.callbacks.length > 0) {
        for (const callback of post.callbacks) {
          try {
            const callbackData: Result = {
              id: post._id,
              date: new Date(),
              sources: { ...data }
            };

            callback(callbackData);
          } catch (e) {
            console.error(`Error processing callback for ${post._id}`);
            console.error(e);
          }
        }
      }

      await Database.removeFromQueue(post._id);
      await Database.updateSourceData(post._id, data);

      console.log(`[SourceCheckerManager] Processed post ${post._id}. Remaining: ${this.queue.length}`);
    } catch (e) {
      console.error(e);
    }

    setTimeout(() => {
      this.queueRoutine();
    }, 400);
  }

  static async queuePosts(posts: DatabasePost[], force = false, callbacks: CallbackFunction[] | null = null, additionalSources: string[] = []) {
    if (posts.length == 0) return;
    console.log(`[SourceCheckerManager] Attempting to queue ${posts.length} posts.`);

    const queueBulk = Database.startQueueBulk();
    const sourceBulk = Database.startSourceBulk();

    const itemsToQueue: SourceCheckQueueItem[] = [];

    for (const post of posts) {
      const combinedSources = post.sources.concat(additionalSources);

      if ((!post.isPending && !force)
        || post.isDeleted
        || !this.anyLinksSupported(combinedSources)) {
        let index = -1;
        if ((index = this.queue.findIndex(p => p._id == post._id)) != -1) this.queue.removeAt(index);
        queueBulk.find({ _id: post._id }).deleteOne();
        continue;
      }

      if (combinedSources.length == 0) {
        queueBulk.find({ _id: post._id }).deleteOne();
        continue;
      }

      const priority = callbacks ? Priority.HIGH : Priority.LOW;

      let current: BaseSourceData | null = null;

      if ((current = await Database.getSource(post._id)) != null) {
        if (force) {
          sourceBulk.find({ _id: post._id }).deleteOne();
        } else {
          const allSourcesChecked = combinedSources.every(s => !this.isSupportedSource(s) || current!.sources?.[s] != null);

          if (allSourcesChecked) continue;
        }
      }

      const toQueue: SourceCheckQueueItem = {
        ...post,
        sources: combinedSources,
        date: new Date(),
        priority,
        callbacks: callbacks ? callbacks : []
      };

      if (priority == Priority.HIGH) {
        this.queue.deleteItem(post._id);
      } else if (this.queue.replaceItem(post._id, toQueue)) {
        continue;
      }

      itemsToQueue.push(toQueue);
    }

    console.log(`[SourceCheckerManager] Actually queued ${itemsToQueue.length} posts.`);

    for (const item of itemsToQueue) {
      queueBulk.find({ _id: item._id }).upsert().replaceOne(item);
      this.queue.addItem(item);
    }

    if (sourceBulk.batches.length > 0) await sourceBulk.execute();
    if (queueBulk.batches.length > 0) await queueBulk.execute();

    if (!this.queueRunning) this.queueRoutine();
  }

  static async processPost(queueItem: SourceCheckQueueItem): Promise<SourceDataMap> {
    let combinedData: SourceDataMap = {};

    const current = await Database.getSource(queueItem._id);

    if (current?.sources) combinedData = current.sources!;

    if (!queueItem.phash) {
      try {
        // console.log(`[SourceChecker] Calculating phash of ${queueItem._id}`);
        const e6Url = `https://static1.e621.net/data/${queueItem.md5.slice(0, 2)}/${queueItem.md5.slice(2, 4)}/${queueItem.md5}.${queueItem.fileType}`;
        const res = await fetch(e6Url);
        if (res.ok) {
          if (res.headers.get('Content-Type')?.startsWith('image/')) {
            let phash: string;
            // console.log(`[SourceChecker] Fetched data of ${queueItem._id}`);
            const data = await res.arrayBuffer();
            // console.log(`[SourceChecker] Got arraybuffer data for ${queueItem._id}`);
            try {
              // console.log(`[SourceChecker] Doing phash calculation for ${queueItem._id}`);
              phash = await calcPhash(data);
            } catch (e) {
              console.error('Error while calculating phash');
              console.error(e);
              phash = '9'.repeat(64);
            }
            queueItem.phash = phash;
          } else {
            queueItem.phash = '9'.repeat(64);
          }
        } else {
          console.error(`Failed to fetch e621 post image for ${queueItem._id}`);
          queueItem.phash = '9'.repeat(64);
        }
      } catch (e) {
        console.error(e);
        queueItem.phash = '9'.repeat(64);
      }

      await Database.updatePost(queueItem._id, { phash: queueItem.phash });
    }

    if (!queueItem.sources) return combinedData;

    for (const sourceChecker of this.sourceCheckers) {
      // console.log(`[SourceCheckerManager] Processing post ${queueItem._id} with ${sourceChecker.name}`);
      const data = await sourceChecker.processPost(queueItem, current);
      for (const [key, value] of Object.entries(data)) {
        if (value.error) {
          console.error(`[SourceCheckerManager] Error while processing post ${queueItem._id} with ${sourceChecker.name} on source: ${key}`);
        }

        combinedData[key] = value;
      }
    }

    return combinedData;
  }

  static anyLinksSupported(links: string[]): boolean {
    for (const source of links) {
      if (this.isSupportedSource(source)) return true;
    }

    return false;
  }

  static hasAnySupportedSources(post: DatabasePost): boolean {
    return this.anyLinksSupported(post.sources);
  }

  static getSupportedSources(post: DatabasePost): string[] {
    const supported: string[] = [];

    for (const source of post.sources) {
      if (this.isSupportedSource(source)) supported.push(source);
    }

    return supported;
  }

  static isSupportedSource(source: string): boolean {
    for (const sourceChecker of this.sourceCheckers) {
      if (sourceChecker.supportsSource(source)) return true;
    }

    return false;
  }

  static update(id: number, waitForData = false, forcePostUpdate = false): Promise<Result> {
    return new Promise(async (resolve, reject) => {
      if (forcePostUpdate) {
        console.log(`[SourceCheckerManager] Forcefully updating post: ${id} from source checker`);
        await E621Handler.updatePost(id, true);
        console.log('[SourceCheckerManager] Updated');
      }

      let post = await Database.getPost(id);

      if (!post) {
        if (forcePostUpdate) return resolve({ id, notIndexed: true });

        console.log(`[SourceCheckerManager] Forcefully updating post: ${id} from source checker`);
        post = await E621Handler.updatePost(id, true);

        if (!post) return resolve({ id, notIndexed: true });
      }

      await Database.deleteSource(id);

      const supportedSources = this.getSupportedSources(post);

      if (supportedSources.length == 0) return resolve({ id, unsupported: true });

      let index = -1;

      if ((index = this.queue.findIndex(p => p._id == id)) == -1) {
        if (!waitForData) {
          await this.queuePosts([post], true);
          return resolve({ id, queued: true });
        } else {
          return this.queuePosts([post], true, [resolve]);
        }
      } else {
        if (!waitForData) {
          return resolve({ id, queued: true });
        } else {
          const item = this.queue.removeAt(index);
          if (!item.callbacks) item.callbacks = [];

          item.callbacks.push(resolve);

          return this.queuePosts([post], true, item.callbacks);
        }
      }
    });
  }

  // static async checkBulk(ids: number[], checkApproved = false) {
  //   try {
  //     const allData: BaseSourceData[] = await Database.getManySources(ids);

  //     const posts: Post[] = await Database.getManyPosts(ids);

  //     const returnData: Result[] = [];

  //     const toQueue: Post[] = [];

  //     for (const post of posts) {
  //       const supportedSources = this.getSupportedSources(post);

  //       ids.splice(ids.indexOf(post.id), 1);

  //       const data = allData.find(d => d._id == post.id);

  //       if (!data || !data.sources) {
  //         if (!post.isPending && !checkApproved) {
  //           returnData.push({ id: post.id, notPending: true });
  //           continue;
  //         }

  //         if (post.isDeleted || post.sources.length == 0 || supportedSources.length == 0) {
  //           returnData.push({ id: post.id, unsupported: true });
  //           continue;
  //         }

  //         if (!this.queue.hasItem(post.id)) {
  //           toQueue.push(post);
  //         }

  //         returnData.push({ id: post.id, queued: true });
  //         continue;
  //       }

  //       if (supportedSources.some(s => !data.sources![s])) {
  //         if (!this.queue.hasItem(post.id)) {
  //           toQueue.push(post);
  //           returnData.push({ id: post.id, queued: true });
  //           continue;
  //         }
  //       }

  //       returnData.push({ id: post.id, sources: data.sources });
  //     }

  //     if (toQueue.length > 0) {
  //       await this.queuePosts(toQueue, checkApproved);
  //     }

  //     for (const id of ids) {
  //       returnData.push({ id, notIndexed: true, notPending: true });
  //     }

  //     return returnData;
  //   } catch (e) {
  //     console.error(e);
  //     return {};
  //   }
  // }
}