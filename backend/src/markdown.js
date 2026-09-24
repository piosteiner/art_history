// *_md columns → safe HTML for the frontend. markdown-it already escapes raw HTML (html: false);
// sanitize-html is the second fence, so a mistake in one of them can't inject script into the site.
const MarkdownIt = require('markdown-it');
const sanitizeHtml = require('sanitize-html');

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });

const SANITIZE = {
  allowedTags: ['p', 'br', 'hr', 'em', 'strong', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
    'h2', 'h3', 'h4', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub', 's'],
  allowedAttributes: { a: ['href', 'title'], th: ['align'], td: ['align'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener' }) },
};

const renderMarkdown = (text) => (text ? sanitizeHtml(md.render(text), SANITIZE) : null);

module.exports = { renderMarkdown };
