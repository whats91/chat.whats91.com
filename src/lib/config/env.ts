// Environment configuration with type safety

interface EnvConfig {
  // WhatsApp Cloud API
  whatsappApiUrl: string;
  whatsappApiVersion: string;
  whatsappVerifyToken: string;
  whatsappAccessToken: string;
  whatsappPhoneNumberId: string;
  whatsappAppSecret: string;
  
  // Database
  databaseUrl: string;
  redisUrl: string;
  
  // App
  appUrl: string;
  appEnv: 'development' | 'staging' | 'production';
  
  // Auth
  nextAuthSecret: string;
  nextAuthUrl: string;
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    console.warn(`Environment variable ${key} is not set`);
    return '';
  }
  return value;
}

export const env: EnvConfig = {
  // WhatsApp Cloud API
  whatsappApiUrl: getEnvVar('WHATSAPP_API_URL', 'https://graph.facebook.com'),
  whatsappApiVersion: getEnvVar('WHATSAPP_API_VERSION', 'v18.0'),
  whatsappVerifyToken: getEnvVar('WHATSAPP_VERIFY_TOKEN', 'mock_verify_token'),
  whatsappAccessToken: getEnvVar('WHATSAPP_ACCESS_TOKEN', ''),
  whatsappPhoneNumberId: getEnvVar('WHATSAPP_PHONE_NUMBER_ID', ''),
  whatsappAppSecret: getEnvVar('WHATSAPP_APP_SECRET', ''),
  
  // Database
  databaseUrl: getEnvVar('DATABASE_URL', 'file:./db/custom.db'),
  redisUrl: getEnvVar('REDIS_URL', 'redis://localhost:6379'),
  
  // App
  appUrl: getEnvVar('NEXT_PUBLIC_APP_URL', 'http://localhost:3000'),
  appEnv: (getEnvVar('NODE_ENV', 'development') as EnvConfig['appEnv']) || 'development',
  
  // Auth
  nextAuthSecret: getEnvVar('NEXTAUTH_SECRET', 'mock_secret_key_for_development'),
  nextAuthUrl: getEnvVar('NEXTAUTH_URL', 'http://localhost:3000'),
};

export function isDevelopment(): boolean {
  return env.appEnv === 'development';
}

export function isProduction(): boolean {
  return env.appEnv === 'production';
}
