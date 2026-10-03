import { ApiError } from '../api';
import { html, render } from '../html';

export function loading(main: HTMLElement) {
  render(main, html`<p class="muted loading">Loading…</p>`);
}

export function showError(el: HTMLElement, err: unknown) {
  if (err instanceof ApiError && err.status === 404) {
    render(el, html`<section class="page"><h1>Not found</h1><p>${err.message}.</p><p><a href="/">Back to the start</a></p></section>`);
    return;
  }
  console.error(err);
  const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : 'The API could not be reached.';
  render(el, html`<div class="error"><strong>Something went wrong.</strong> ${msg}</div>`);
}

/** Ignores results of a view the user has already navigated away from. */
export function guard() {
  const start = location.pathname + location.search;
  return () => location.pathname + location.search === start;
}
