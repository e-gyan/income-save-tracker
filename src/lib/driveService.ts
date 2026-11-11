/**
 * Google Drive Client Integration Service
 * Uses Google Drive REST API v3 to list folders and extract financial document summaries,
 * including native .pdf and .epub files.
 */

import { ParsedDocument, parseEpubBuffer, parsePdfBuffer } from './documentParser.ts';

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
}

export interface GoogleDriveFolder {
  id: string;
  name: string;
  modifiedTime?: string;
  parentId?: string;
}

/**
 * Lists user's Google Drive folders
 */
export async function listGoogleDriveFolders(accessToken: string): Promise<GoogleDriveFolder[]> {
  const query = encodeURIComponent("mimeType = 'application/vnd.google-apps.folder' and trashed = false");
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,modifiedTime,parents)&orderBy=modifiedTime desc&pageSize=50`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to list Drive folders (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  return (data.files || []).map((f: any) => ({
    id: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime,
    parentId: f.parents && f.parents.length > 0 ? f.parents[0] : undefined,
  }));
}

/**
 * Lists files and subfolders within a specific Google Drive folder
 */
export async function listGoogleDriveFiles(
  folderId: string,
  accessToken: string
): Promise<GoogleDriveFile[]> {
  const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType,size,modifiedTime)&orderBy=modifiedTime desc&pageSize=50`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to list Drive files in folder (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  return data.files || [];
}

/**
 * Fetches and parses a Drive document into a structured ParsedDocument,
 * with full support for .pdf (native base64 for Gemini), .epub (chapter text extraction),
 * Google Docs, Google Sheets, and plain text.
 */
export async function fetchDriveDocument(
  fileId: string,
  fileName: string,
  mimeType: string,
  accessToken: string
): Promise<ParsedDocument> {
  const lowerName = fileName.toLowerCase();

  // 1. PDF Documents
  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Drive PDF read failed (${res.status})`);
    const buffer = await res.arrayBuffer();
    const doc = await parsePdfBuffer(buffer, fileName);
    doc.id = fileId;
    return doc;
  }

  // 2. EPUB eBooks / Financial strategy books
  if (
    mimeType === 'application/epub+zip' ||
    mimeType.includes('epub') ||
    lowerName.endsWith('.epub')
  ) {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Drive EPUB read failed (${res.status})`);
    const buffer = await res.arrayBuffer();
    const doc = await parseEpubBuffer(buffer, fileName);
    doc.id = fileId;
    return doc;
  }

  // 3. Google Docs (Export to clean text)
  if (mimeType === 'application/vnd.google-apps.document') {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const text = res.ok ? await res.text() : 'Google Doc preview unavailable';
    return {
      id: fileId,
      title: fileName,
      fileType: 'doc',
      mimeType,
      snippet: text.slice(0, 30000),
    };
  }

  // 4. Google Sheets (Export to CSV)
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const text = res.ok ? await res.text() : 'Google Sheet CSV preview unavailable';
    return {
      id: fileId,
      title: fileName,
      fileType: 'sheet',
      mimeType,
      snippet: text.slice(0, 30000),
    };
  }

  // 5. Text / CSV / JSON
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    return {
      id: fileId,
      title: fileName,
      fileType: 'text',
      mimeType,
      snippet: `Unable to read document (${res.status})`,
    };
  }
  const text = await res.text();
  return {
    id: fileId,
    title: fileName,
    fileType: lowerName.endsWith('.csv') ? 'sheet' : 'text',
    mimeType,
    snippet: text.slice(0, 30000),
  };
}

/**
 * Extracts a readable snippet of a Drive file for backwards compatibility
 */
export async function fetchDriveFileSnippet(
  fileId: string,
  mimeType: string,
  accessToken: string,
  fileName: string = 'Document'
): Promise<string> {
  try {
    const doc = await fetchDriveDocument(fileId, fileName, mimeType, accessToken);
    return doc.snippet || `Document [${doc.title}] (${doc.fileType.toUpperCase()})`;
  } catch (err: any) {
    console.warn('Error reading Drive file snippet:', err);
    return 'Content summary unavailable.';
  }
}
