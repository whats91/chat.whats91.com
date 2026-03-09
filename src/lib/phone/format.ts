export function formatChatPhoneNumber(phone: string | null | undefined): string {
  if (!phone) {
    return '';
  }

  return phone.trim().replace(/^\+/, '');
}
