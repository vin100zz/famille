'use strict';

class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async search(query) {
    return this._get('search.php', { q: query });
  }

  async getPerson(id) {
    return this._get('person.php', { id });
  }

  async getSosaTree(sosa) {
    return this._get('sosa-tree.php', { sosa });
  }

  async savePerson(id, data) {
    return this._post('save.php', { type: 'person', id, data });
  }

  async saveFamily(id, data) {
    return this._post('save.php', { type: 'family', id, data });
  }

  async saveAll(payload) {
    return this._post('save.php', { type: 'save_all', id: '_batch', data: payload });
  }

  async uploadImage(file) {
    const form = new FormData();
    form.append('image', file);
    const url = this.baseUrl + '/upload.php';
    const r = await fetch(url, { method: 'POST', body: form });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error || 'Erreur upload HTTP ' + r.status);
    }
    return r.json();
  }

  async _get(endpoint, params) {
    const qs = Object.keys(params)
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
      .join('&');
    const url = this.baseUrl + '/' + endpoint + '?' + qs;
    const r = await fetch(url);
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body.error || 'Erreur HTTP ' + r.status);
    }
    return r.json();
  }

  async _post(endpoint, body) {
    const url = this.baseUrl + '/' + endpoint;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const resp = await r.json().catch(() => ({}));
      throw new Error(resp.error || 'Erreur HTTP ' + r.status);
    }
    return r.json();
  }
}
