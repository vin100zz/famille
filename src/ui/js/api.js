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
}
