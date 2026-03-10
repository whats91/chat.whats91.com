import 'server-only';

// Dependency note:
// Template parsing or field changes here must stay aligned with:
// - prisma/schema.prisma
// - src/lib/types/chat.ts
// - src/server/controllers/conversation-controller.ts
// - src/components/chat/TemplatePickerDialog.tsx

import { db } from '@/lib/db';
import { Logger } from '@/lib/logger';
import type {
  WhatsAppTemplateButtonDefinition,
  WhatsAppTemplateCategory,
  WhatsAppTemplateDefinition,
  WhatsAppTemplateMediaType,
  WhatsAppTemplateParameterDefinition,
  WhatsAppTemplateParameterFormat,
  WhatsAppTemplateStatus,
} from '@/lib/types/chat';

const log = new Logger('CloudTemplatesDB');

interface CloudWhatsappTemplateRow {
  id: string | number | bigint;
  uid: string | null;
  user_id: string | number | bigint;
  template_name: string | null;
  phone_number: string | number | bigint | null;
  template_id: string | null;
  category: string | null;
  language: string | null;
  temp_data: string | null;
  status: string;
  meta_template_id: string | null;
  waba_id: string | null;
  quality_rating: string | null;
  rejection_reason: string | null;
  meta_raw_data: string | null;
  template_media_url: string | null;
  template_media_type: string | null;
  parameter_format: string | null;
  base_template_name: string | null;
  version: number | string;
  versioned_template_name: string | null;
  is_active_version: number | boolean;
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeCategory(value: string | null): WhatsAppTemplateCategory {
  const normalized = (value || '').toUpperCase();
  if (normalized === 'MARKETING' || normalized === 'AUTHENTICATION') {
    return normalized;
  }
  return 'UTILITY';
}

function normalizeStatus(value: string | null): WhatsAppTemplateStatus {
  const normalized = (value || '').toUpperCase();
  if (
    normalized === 'APPROVED' ||
    normalized === 'REJECTED' ||
    normalized === 'PENDING' ||
    normalized === 'PAUSED' ||
    normalized === 'DISABLED'
  ) {
    return normalized;
  }
  return 'DRAFT';
}

function normalizeMediaType(value: string | null): WhatsAppTemplateMediaType {
  const normalized = (value || '').toUpperCase();
  if (normalized === 'IMAGE' || normalized === 'VIDEO' || normalized === 'DOCUMENT') {
    return normalized;
  }
  return 'NONE';
}

function normalizeParameterFormat(value: string | null): WhatsAppTemplateParameterFormat {
  return (value || '').toUpperCase() === 'NAMED' ? 'NAMED' : 'POSITIONAL';
}

function humanizeParameterKey(key: string): string {
  if (/^\d+$/.test(key)) {
    return `Parameter ${key}`;
  }

  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function extractPlaceholderKeys(text: string | null): string[] {
  if (!text) {
    return [];
  }

  const matches = Array.from(text.matchAll(/{{\s*([^}]+?)\s*}}/g));
  return Array.from(
    new Set(
      matches
        .map((match) => match[1]?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
}

function buildExampleMap(
  placeholderKeys: string[],
  exampleSource: unknown,
  parameterFormat: WhatsAppTemplateParameterFormat
): Map<string, string> {
  const exampleMap = new Map<string, string>();

  if (parameterFormat === 'POSITIONAL') {
    const exampleRow = getArray(exampleSource)[0];
    if (Array.isArray(exampleRow)) {
      placeholderKeys.forEach((key, index) => {
        const exampleValue = exampleRow[index];
        if (typeof exampleValue === 'string' && exampleValue.trim()) {
          exampleMap.set(key, exampleValue.trim());
        }
      });
    }

    return exampleMap;
  }

  const exampleObject = getObject(getArray(exampleSource)[0] ?? exampleSource);
  if (!exampleObject) {
    return exampleMap;
  }

  placeholderKeys.forEach((key) => {
    const exampleValue = getString(exampleObject[key]);
    if (exampleValue) {
      exampleMap.set(key, exampleValue);
    }
  });

  return exampleMap;
}

function upsertParameterDefinition(
  definitions: Map<string, WhatsAppTemplateParameterDefinition>,
  key: string,
  location: WhatsAppTemplateParameterDefinition['location'],
  example: string | null
) {
  const existing = definitions.get(key);
  if (existing) {
    if (!existing.example && example) {
      existing.example = example;
    }
    return;
  }

  definitions.set(key, {
    key,
    label: humanizeParameterKey(key),
    location,
    example,
  });
}

function parseButtonsFromMeta(
  metaComponents: Array<Record<string, unknown>>
): WhatsAppTemplateButtonDefinition[] {
  const buttonsComponent = metaComponents.find((component) => getString(component.type)?.toUpperCase() === 'BUTTONS');
  if (!buttonsComponent) {
    return [];
  }

  return getArray<Record<string, unknown>>(buttonsComponent.buttons).map((button, index) => {
    const url = getString(button.url);
    const phoneNumber = getString(button.phone_number);
    return {
      type: (getString(button.type)?.toUpperCase() as WhatsAppTemplateButtonDefinition['type']) || 'QUICK_REPLY',
      text: getString(button.text) || `Button ${index + 1}`,
      index,
      url,
      phoneNumber,
      dynamicParameterKeys: extractPlaceholderKeys(url),
    };
  });
}

function parseButtonsFromTempData(tempData: Record<string, unknown> | null): WhatsAppTemplateButtonDefinition[] {
  if (!tempData) {
    return [];
  }

  return getArray<Record<string, unknown>>(tempData.buttons).map((button, index) => {
    const url = getString(button.url);
    return {
      type: (getString(button.type)?.toUpperCase() as WhatsAppTemplateButtonDefinition['type']) || 'QUICK_REPLY',
      text: getString(button.text) || `Button ${index + 1}`,
      index,
      url,
      phoneNumber: getString(button.phone_number),
      dynamicParameterKeys: extractPlaceholderKeys(url),
    };
  });
}

function mapTemplateRow(row: CloudWhatsappTemplateRow): WhatsAppTemplateDefinition {
  const tempData = parseJsonObject(row.temp_data);
  const metaRawData = parseJsonObject(row.meta_raw_data);
  const metaComponents = getArray<Record<string, unknown>>(metaRawData?.components);
  const parameterFormat = normalizeParameterFormat(row.parameter_format);
  const headerFromTemp = getObject(tempData?.header);
  const bodyFromTemp = getObject(tempData?.body);
  const footerFromTemp = getObject(tempData?.footer);
  const headerComponent = metaComponents.find((component) => getString(component.type)?.toUpperCase() === 'HEADER');
  const bodyComponent = metaComponents.find((component) => getString(component.type)?.toUpperCase() === 'BODY');
  const footerComponent = metaComponents.find((component) => getString(component.type)?.toUpperCase() === 'FOOTER');

  const headerType = (
    getString(headerFromTemp?.type) ||
    getString(headerComponent?.format) ||
    row.template_media_type
  )?.toUpperCase() || 'NONE';
  const normalizedHeaderType =
    headerType === 'TEXT'
      ? 'TEXT'
      : normalizeMediaType(headerType);
  const headerText = getString(headerFromTemp?.text) || getString(headerComponent?.text);
  const headerExampleHandles = getArray<string>(getObject(headerComponent?.example)?.header_handle);
  const headerMediaUrl = row.template_media_url || headerExampleHandles[0] || null;
  const bodyText = getString(bodyFromTemp?.text) || getString(bodyComponent?.text);
  const footerText = getString(footerFromTemp?.text) || getString(footerComponent?.text);
  const buttonDefinitions = parseButtonsFromMeta(metaComponents);
  const fallbackButtons =
    buttonDefinitions.length > 0 ? buttonDefinitions : parseButtonsFromTempData(tempData);

  const parameterDefinitions = new Map<string, WhatsAppTemplateParameterDefinition>();

  const bodyPlaceholderKeys = extractPlaceholderKeys(bodyText);
  const bodyExamples = buildExampleMap(
    bodyPlaceholderKeys,
    getObject(bodyComponent?.example)?.body_text,
    parameterFormat
  );
  bodyPlaceholderKeys.forEach((key) => {
    upsertParameterDefinition(parameterDefinitions, key, 'BODY', bodyExamples.get(key) || null);
  });

  const headerPlaceholderKeys = extractPlaceholderKeys(headerText);
  headerPlaceholderKeys.forEach((key) => {
    upsertParameterDefinition(parameterDefinitions, key, 'HEADER', null);
  });

  fallbackButtons.forEach((button) => {
    button.dynamicParameterKeys.forEach((key) => {
      upsertParameterDefinition(parameterDefinitions, key, 'BUTTON', null);
    });
  });

  return {
    id: String(row.id),
    uid: row.uid,
    templateName: row.template_name || row.versioned_template_name || row.base_template_name || '',
    baseTemplateName: row.base_template_name,
    version: Number(row.version || 1),
    versionedTemplateName: row.versioned_template_name,
    category: normalizeCategory(row.category),
    language: row.language || 'en',
    status: normalizeStatus(row.status),
    parameterFormat,
    bodyText,
    footerText,
    header: {
      type: normalizedHeaderType,
      text: headerText,
      mediaUrl: headerMediaUrl,
      requiresMediaUpload: normalizedHeaderType !== 'NONE' && normalizedHeaderType !== 'TEXT' && !headerMediaUrl,
    },
    hasDynamicParameters: parameterDefinitions.size > 0,
    parameters: Array.from(parameterDefinitions.values()),
    buttons: fallbackButtons,
  };
}

function normalizePhoneNumberValue(phoneNumber: unknown): string | null {
  if (phoneNumber === null || phoneNumber === undefined) {
    return null;
  }

  const normalizedValue =
    typeof phoneNumber === 'string' || typeof phoneNumber === 'number' || typeof phoneNumber === 'bigint'
      ? String(phoneNumber)
      : null;

  if (!normalizedValue) {
    return null;
  }

  const digits = normalizedValue.replace(/\D/g, '');
  return digits || null;
}

export async function getApprovedTemplatesByUserAndPhoneNumber(
  userId: string,
  phoneNumber: string | null
): Promise<WhatsAppTemplateDefinition[]> {
  const normalizedPhoneNumber = normalizePhoneNumberValue(phoneNumber);

  try {
    const rows = await db.$queryRawUnsafe<CloudWhatsappTemplateRow[]>(
      `SELECT *
       FROM cloud_whatsapp_templates
       WHERE user_id = ?
         AND status = 'APPROVED'
         AND is_active_version = 1
         ${normalizedPhoneNumber ? 'AND phone_number = ?' : ''}
       ORDER BY category ASC, template_name ASC, id DESC`,
      ...(normalizedPhoneNumber ? [userId, normalizedPhoneNumber] : [userId])
    );

    return rows.map(mapTemplateRow);
  } catch (error) {
    log.error('getApprovedTemplatesByUserAndPhoneNumber error', {
      error: error instanceof Error ? error.message : error,
      userId,
      phoneNumber: normalizedPhoneNumber,
    });
    throw error;
  }
}

export async function getApprovedTemplateForSend(params: {
  userId: string;
  phoneNumber: string | null;
  templateRecordId?: string | null;
  templateName?: string | null;
}): Promise<WhatsAppTemplateDefinition | null> {
  const { userId, phoneNumber, templateRecordId, templateName } = params;
  const normalizedPhoneNumber = normalizePhoneNumberValue(phoneNumber);

  if (!templateRecordId && !templateName) {
    return null;
  }

  try {
    const rows = await db.$queryRawUnsafe<CloudWhatsappTemplateRow[]>(
      `SELECT *
       FROM cloud_whatsapp_templates
       WHERE user_id = ?
         AND status = 'APPROVED'
         AND is_active_version = 1
         ${normalizedPhoneNumber ? 'AND phone_number = ?' : ''}
         AND (${templateRecordId ? 'id = ?' : '0 = 1'} OR ${templateName ? 'template_name = ? OR versioned_template_name = ?' : '0 = 1'})
       ORDER BY id DESC
       LIMIT 1`,
      ...[
        userId,
        ...(normalizedPhoneNumber ? [normalizedPhoneNumber] : []),
        ...(templateRecordId ? [templateRecordId] : []),
        ...(templateName ? [templateName, templateName] : []),
      ]
    );

    const row = rows[0];
    return row ? mapTemplateRow(row) : null;
  } catch (error) {
    log.error('getApprovedTemplateForSend error', {
      error: error instanceof Error ? error.message : error,
      userId,
      phoneNumber: normalizedPhoneNumber,
      templateRecordId,
      templateName,
    });
    throw error;
  }
}
