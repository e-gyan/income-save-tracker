import JSZip from 'jszip';

export interface ParsedDocument {
  id: string;
  title: string;
  fileType: 'pdf' | 'epub' | 'doc' | 'sheet' | 'text';
  sizeBytes?: number;
  snippet?: string;
  base64Data?: string; // For PDFs to send to Gemini multimodal
  mimeType?: string;
}

/**
 * Strips HTML tags and unescapes standard HTML entities for clean plain text.
 */
function cleanHtmlText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses an EPUB file (ArrayBuffer) by inspecting the ZIP container and
 * concatenating readable XHTML/HTML content chapters into clean plain text.
 */
export async function parseEpubBuffer(
  buffer: ArrayBuffer,
  fileName: string = 'Ebook Document'
): Promise<ParsedDocument> {
  const zip = await JSZip.loadAsync(buffer);
  const chapterFiles: { name: string; file: JSZip.JSZipObject }[] = [];

  // Look for HTML/XHTML chapter files
  zip.forEach((relativePath, zipEntry) => {
    const lower = relativePath.toLowerCase();
    if (
      !zipEntry.dir &&
      (lower.endsWith('.xhtml') ||
        lower.endsWith('.html') ||
        lower.endsWith('.htm') ||
        lower.endsWith('.xml')) &&
      !lower.includes('container.xml') &&
      !lower.includes('toc.ncx')
    ) {
      chapterFiles.push({ name: relativePath, file: zipEntry });
    }
  });

  // Sort chapter files logically (by path/name)
  chapterFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const extractedChapters: string[] = [];
  let totalLength = 0;
  const MAX_TEXT_LENGTH = 60000; // Reasonable context window for prompt

  for (const item of chapterFiles) {
    if (totalLength >= MAX_TEXT_LENGTH) break;
    try {
      const rawHtml = await item.file.async('text');
      const clean = cleanHtmlText(rawHtml);
      if (clean.length > 50) {
        extractedChapters.push(clean);
        totalLength += clean.length;
      }
    } catch (e) {
      console.warn(`Could not read chapter ${item.name}:`, e);
    }
  }

  const fullText = extractedChapters.join('\n\n--- Next Section ---\n\n');
  const previewSnippet = fullText.slice(0, MAX_TEXT_LENGTH);

  return {
    id: `epub_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: fileName,
    fileType: 'epub',
    sizeBytes: buffer.byteLength,
    mimeType: 'application/epub+zip',
    snippet: previewSnippet || 'EPUB text contents extracted.',
  };
}

/**
 * Converts ArrayBuffer into a base64 string
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

/**
 * Parses a PDF buffer into base64 for Gemini native multimodal analysis
 */
export async function parsePdfBuffer(
  buffer: ArrayBuffer,
  fileName: string = 'Financial Document.pdf'
): Promise<ParsedDocument> {
  const base64Data = arrayBufferToBase64(buffer);

  return {
    id: `pdf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: fileName,
    fileType: 'pdf',
    sizeBytes: buffer.byteLength,
    mimeType: 'application/pdf',
    base64Data,
    snippet: `Attached PDF document (${(buffer.byteLength / 1024).toFixed(1)} KB) - full native document ingestion via Gemini 3.8 Flash.`,
  };
}

/**
 * Handles browser File objects (.pdf, .epub, .txt, .csv, .json, .md)
 */
export async function parseUploadedFile(file: File): Promise<ParsedDocument> {
  const lowerName = file.name.toLowerCase();

  if (lowerName.endsWith('.epub') || file.type.includes('epub')) {
    const buffer = await file.arrayBuffer();
    return parseEpubBuffer(buffer, file.name);
  }

  if (lowerName.endsWith('.pdf') || file.type.includes('pdf')) {
    const buffer = await file.arrayBuffer();
    return parsePdfBuffer(buffer, file.name);
  }

  // Plain text, markdown, csv, json
  const text = await file.text();
  let fileType: ParsedDocument['fileType'] = 'text';
  if (lowerName.endsWith('.csv') || lowerName.endsWith('.xlsx')) fileType = 'sheet';

  return {
    id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: file.name,
    fileType,
    sizeBytes: file.size,
    mimeType: file.type || 'text/plain',
    snippet: text.slice(0, 30000),
  };
}
