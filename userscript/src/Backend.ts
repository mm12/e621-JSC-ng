import type { ServerResponse } from '../../shared';
import { BACKEND_URL_BASE } from './Constants';

export function getData(id: number, force = false, updatePost = false): Promise<ServerResponse> {
  return new Promise((resolve, reject) => {
    const path = force || updatePost ? `checksources/update/${id}?forcepostupdate=${updatePost}&waitfordata=true` : `checksources/${id}`;

    GM.xmlHttpRequest({
      method: 'GET',
      url: `${BACKEND_URL_BASE}/${path}`,
      onload: function (response) {
        try {
          const data = JSON.parse(response.responseText);

          resolve(data);
        } catch (e) {
          console.error(response.responseText);
          reject(e);
        }
      },
      onerror: function (e) {
        reject(e);
      }
    });
  });
}

export function getDataBulk(ids: number[] | string[]): Promise<ServerResponse[]> {
  return new Promise((resolve, reject) => {
    if (ids.length == 0) return resolve([]);

    GM.xmlHttpRequest({
      method: 'GET',
      url: `${BACKEND_URL_BASE}/checksources/bulk?ids=${Array.from(new Set<number | string>(ids)).join(',')}`,
      onload: function (response) {
        try {
          const data = JSON.parse(response.responseText);

          resolve(data);
        } catch (e) {
          console.error(response.responseText);
          reject(e);
        }
      },
      onerror: function (e) {
        reject(e);
      }
    });
  });
}

export function anyLinksSupported(links: string[]): Promise<boolean> {
  return new Promise((resolve, reject) => {
    GM.xmlHttpRequest({
      method: 'POST',
      url: `${BACKEND_URL_BASE}/checksupported`,
      headers: {
        'Content-Type': 'application/json'
      },
      data: JSON.stringify(links),
      onload: function (response) {
        try {
          const data: { supported: boolean } = JSON.parse(response.responseText);

          resolve(data.supported);
        } catch (e) {
          console.error(response.responseText);
          reject(e);
        }
      },
      onerror: function (e) {
        reject(e);
      }
    });
  });
}

export function checkFluffleLinks(id: number, links: string[]): Promise<ServerResponse> {
  return new Promise((resolve, reject) => {
    GM.xmlHttpRequest({
      method: 'POST',
      url: `${BACKEND_URL_BASE}/checkadditionalsources/${id}`,
      headers: {
        'Content-Type': 'application/json'
      },
      data: JSON.stringify(links),
      onload: function (response) {
        try {
          resolve(JSON.parse(response.responseText));
        } catch (e) {
          console.error(response.responseText);
          reject(e);
        }
      },
      onerror: function (e) {
        reject(e);
      }
    });
  });
}