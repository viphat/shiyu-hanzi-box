import { describe, it, expect } from 'vitest';
import { isBlankOrBrowserPage } from '../lib/page-context';

describe('isBlankOrBrowserPage', () => {
  it('treats real http(s) content pages as capturable sources', () => {
    expect(isBlankOrBrowserPage('https://example.com/article')).toBe(false);
    expect(isBlankOrBrowserPage('http://news.example/story')).toBe(false);
    expect(isBlankOrBrowserPage('file:///Users/me/book.html')).toBe(false);
  });

  it('treats the blank page as a non-source page', () => {
    expect(isBlankOrBrowserPage('about:blank')).toBe(true);
  });

  it('treats an empty/unknown url as a non-source page', () => {
    expect(isBlankOrBrowserPage('')).toBe(true);
    expect(isBlankOrBrowserPage('   ')).toBe(true);
  });

  it('treats New Tab Pages across browsers as non-source pages', () => {
    expect(isBlankOrBrowserPage('chrome://newtab/')).toBe(true);
    expect(isBlankOrBrowserPage('chrome://new-tab-page/')).toBe(true);
    expect(isBlankOrBrowserPage('edge://newtab/')).toBe(true);
    expect(isBlankOrBrowserPage('about:newtab')).toBe(true);
    expect(isBlankOrBrowserPage('about:home')).toBe(true);
    expect(isBlankOrBrowserPage('chrome-search://local-ntp/local-ntp.html')).toBe(true);
  });

  it('treats browser internal / dashboard pages as non-source pages', () => {
    expect(isBlankOrBrowserPage('chrome://settings/')).toBe(true);
    expect(isBlankOrBrowserPage('chrome://extensions/')).toBe(true);
    expect(isBlankOrBrowserPage('edge://favorites/')).toBe(true);
  });

  it('treats the extension dashboard (browser dashboard page) as a non-source page', () => {
    expect(isBlankOrBrowserPage('chrome-extension://abcdef/dashboard.html')).toBe(true);
    expect(isBlankOrBrowserPage('moz-extension://abcdef/dashboard.html')).toBe(true);
  });

  it('is case-insensitive on the scheme', () => {
    expect(isBlankOrBrowserPage('About:Blank')).toBe(true);
    expect(isBlankOrBrowserPage('CHROME://newtab/')).toBe(true);
  });
});
