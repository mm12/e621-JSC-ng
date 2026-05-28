import { anyLinksSupported, checkFluffleLinks, sendSources } from './Backend';
import { FluffleFaces, FluffleMessages, UserAgent } from './Constants';
import { addSourceSign, spinner } from './icons';
import { getImageBlob, processData } from './Utilities';

type FluffleAuthor = {
  id: string
  name: string
}

type FluffleThumbnail = {
  width: number
  centerX: number
  height: number
  centerY: number
  url: string
}

type FluffleResult = {
  id: string
  distance: number
  match: 'exact' | 'probable' | 'unlikely'
  platform: string
  url: string
  isSfw: boolean
  thumbnail: FluffleThumbnail | null
  authors: FluffleAuthor[]
}

type FluffleResponse = {
  id: string
  result: FluffleResult[]
}

export function getFluffleData(blob: Blob): Promise<FluffleResponse> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('limit', '32');
    formData.append('file', blob, 'image.png');

    GM.xmlHttpRequest({
      method: 'POST',
      url: 'https://api.fluffle.xyz/exact-search-by-file',
      headers: {
        'User-Agent': UserAgent,
        'Accept': 'application/json'
      },
      onload: function (response) {
        try {
          resolve(JSON.parse(response.responseText));
        } catch (e) {
          reject(e);
        }
      },
      onerror: function (e) {
        reject(e);
      },
      data: formData,
      fetch: true
    });
  });
}

export async function checkFluffle(id: number) {
  const cachedData = await getFluffleCache(id);

  let fluffleData;

  if (!cachedData) {
    const container = document.getElementById('image-container');
    if (!container) return;

    const fileType = container.getAttribute('data-file-ext');

    if (fileType == 'webm' || fileType == 'mp4') return;

    createTemporaryList();

    const fileUrl = container.getAttribute('data-file-url');
    const imageBlob = await getImageBlob(fileUrl);

    if (!imageBlob) {
      console.error('[SourceVerifier] Failed to get image blob from file url');
      return;
    }

    fluffleData = await getFluffleData(imageBlob);
  }

  const fluffleResults = cachedData ?? fluffleData.results.filter(r => r.match == 'exact' && r.platform != 'e621');

  if (!cachedData && fluffleResults.length > 0) await setFluffleCache(id, fluffleResults);

  const links = addResults(fluffleResults);

  if (await anyLinksSupported(links)) {
    const linkElement = document.querySelector('#fluffle-results .source-links');
    if (!linkElement) {
      console.error('[SourceVerifier] Fluffle source links list not found');
      return;
    }
    const spinny = spinner.cloneNode(true) as HTMLElement;
    linkElement.insertBefore(spinny, linkElement.firstElementChild);

    const data = await checkFluffleLinks(id, links);

    spinny.remove();

    await processData(data, false, '#fluffle-results .source-links');
  }
}

export async function hasCachedFluffleData(id: number): Promise<boolean> {
  return await getFluffleCache(id) != null;
}

async function getFluffleCache(id: number): Promise<FluffleResult[] | null> {
  const fluffleCache = JSON.parse(await GM.getValue('fluffleCache', '[]')) as { id: number, data: FluffleResult[] }[];

  return fluffleCache.find(c => c.id == id)?.data ?? null;
}

async function setFluffleCache(id: number, data: FluffleResult[]) {
  const fluffleCache = JSON.parse(await GM.getValue('fluffleCache', '[]'));
  fluffleCache.unshift({ id: id, data });

  if (fluffleCache.length >= 10) fluffleCache.pop();

  await GM.setValue('fluffleCache', JSON.stringify(fluffleCache));
}

let sourcesToAdd: string[] = [];
let timeout;

async function sendSourcesToVerifier() {
  timeout = null;
  await sendSources(sourcesToAdd);
  sourcesToAdd = [];
}

function addSource(result: FluffleResult, immediate: boolean, event: PointerEvent) {
  event.stopImmediatePropagation();
  event.preventDefault();

  if (sourcesToAdd.includes(result.url)) return;

  sourcesToAdd.push(result.url);
  if (immediate) {
    sendSourcesToVerifier();
    return;
  }

  if (!timeout) {
    timeout = setTimeout(sendSources, 500);
  } else {
    clearTimeout(timeout);
    timeout = setTimeout(sendSources, 500);
  }
}

export function createFluffleSource(result: FluffleResult, immediate: boolean = false) {
  const div = document.createElement('div');
  div.classList.add('source-link', 'fluffle621-source-link');

  const wrappedAnchor = document.createElement('a');

  wrappedAnchor.onclick = addSource.bind(null, result, immediate);

  wrappedAnchor.title = 'Add source';
  wrappedAnchor.appendChild(addSourceSign.cloneNode(true));
  div.appendChild(wrappedAnchor);

  if (result.url.endsWith('/')) result.url = result.url.slice(0, -1);

  const a = document.createElement('a');
  a.classList.add('decorated', 'fluffle621-source');
  a.target = '_blank';
  a.rel = 'nofollow noreferrer noopener';
  a.href = result.url;
  a.innerText = result.url;

  div.appendChild(a);

  return div;
}

function addResults(results: FluffleResult[]): string[] {
  const urls: string[] = [];
  const realSourceLinks = Array.from(document.querySelectorAll<HTMLElement | HTMLAnchorElement>('.source-link > *')).map((a) => {
    let url;
    if (a.tagName == 'S') {
      try {
        url = new URL(a.innerText);
      } catch (e) {
        return null;
      }
    } else {
      const asAnchor = a as HTMLAnchorElement;
      url = new URL(asAnchor.href);
    }
    if (url.hostname == 'twitter.com') url.hostname = 'x.com';
    if (url.hostname.endsWith('weasyl.com')) {
      if (!url.pathname.match(/\d+$/)) {
        const id = /\/submissions?\/(\d+)/.exec(url.pathname)![1];
        url = new URL(`https://www.weasyl.com/submission/${id}`);
      }
    }
    const u = url.toString();
    return u.endsWith('/') ? u.slice(0, -1) : u;
  }).filter(a => a);

  const existingList = document.querySelector('.post-sidebar-info');

  document.getElementById('fluffle-results')?.remove();

  const list = document.createElement('ul');
  list.id = 'fluffle-results';
  list.setAttribute('data-loaded', 'true');
  list.classList.add('post-sidebar-info');

  const listItem = document.createElement('li');
  listItem.classList.add('source-links');
  listItem.append('Fluffle:');

  if (results.length == 0) {
    listItem.appendChild(document.createElement('br'));
    listItem.append(getRandomEmptyResultMessage());
  } else {
    for (const result of results) {
      let url = new URL(result.url);
      if (url.hostname == 'twitter.com') url.hostname = 'x.com';
      if (url.hostname.endsWith('weasyl.com')) {
        if (!url.pathname.match(/\d+$/)) {
          const id = /\/submissions?\/(\d+)/.exec(url.pathname)![1];
          url = new URL(`https://www.weasyl.com/submission/${id}`);
        }
      }
      let u = url.toString();
      u = u.endsWith('/') ? u.slice(0, -1) : u;
      if (!realSourceLinks.includes(u)) {
        listItem.append(createFluffleSource(result, results.length == 1));
        urls.push(u);
      }
    }
  }

  if (listItem.childElementCount > 0 && existingList != null) {
    list.appendChild(listItem);

    existingList.after(list);
  }

  return urls;
}

function createTemporaryList() {
  const existingList = document.querySelector('.post-sidebar-info');

  const list = document.createElement('ul');
  list.id = 'fluffle-results';
  list.setAttribute('data-loaded', 'false');
  list.classList.add('post-sidebar-info');

  const listItem = document.createElement('li');
  listItem.classList.add('source-links');
  listItem.append('Fluffle:');

  listItem.appendChild(document.createElement('br'));

  const loading = document.createElement('div');
  loading.innerText = 'Loading';
  loading.classList.add('loading');
  listItem.appendChild(loading);

  list.appendChild(listItem);

  if (existingList) existingList.after(list);
}

function getRandomEmptyResultMessage() {
  return `${FluffleMessages[Math.floor(Math.random() * FluffleMessages.length)]} ${FluffleFaces[Math.floor(Math.random() * FluffleFaces.length)]}`;
}