import axios from 'axios';
import { API_URL, attachAuthToken } from './apiConfig';

const api = axios.create({
  baseURL: `${API_URL}/plots`,
  timeout: 60000,
});

const authApi = axios.create({
  baseURL: `${API_URL}/auth`,
  timeout: 60000,
});

const backupApi = axios.create({
  baseURL: `${API_URL}/backup`,
  timeout: 120000, // backups can take longer — give it 2 minutes
});

authApi.interceptors.request.use(async (request) => {
  await attachAuthToken(request);
  if (__DEV__) {
    const path = [request.baseURL?.replace(/\/+$/, ''), request.url?.replace(/^\/+/, '')]
      .filter(Boolean)
      .join('/');
    console.log('[Auth API Request] ->', request.method?.toUpperCase(), path);
  }
  return request;
});

authApi.interceptors.response.use(
  (response) => {
    if (__DEV__) {
      console.log('[Auth API Response] <-', response.status, response.config?.url);
    }
    return response;
  },
  (error) => {
    if (__DEV__) {
      const status = error.response?.status;
      const data = error.response?.data;
      const path = error.config?.baseURL && error.config?.url
        ? `${error.config.baseURL.replace(/\/+$/, '')}/${String(error.config.url).replace(/^\/+/, '')}`
        : error.config?.url;
      console.log('[Auth API Error] <-', status, path, data || error.message);
    }
    return Promise.reject(error);
  },
);

api.interceptors.request.use(async (request) => {
  await attachAuthToken(request);
  if (__DEV__) {
    console.log('[API Request] ->', request.method.toUpperCase(), `${request.baseURL}${request.url ? request.url : ''}`);
  }
  return request;
});

api.interceptors.response.use(
  (response) => {
    if (__DEV__) {
      console.log('[API Response] <- Success:', response.status);
    }
    return response;
  },
  (error) => {
    if (__DEV__) {
      console.log('[API Error] <- Failed:', error.message);
    }
    return Promise.reject(error);
  },
);

backupApi.interceptors.request.use(async (request) => {
  await attachAuthToken(request);
  if (__DEV__) {
    console.log('[Backup API Request] ->', request.method?.toUpperCase(), `${request.baseURL}${request.url ?? ''}`);
  }
  return request;
});

backupApi.interceptors.response.use(
  (response) => {
    if (__DEV__) console.log('[Backup API Response] <- Success:', response.status);
    return response;
  },
  (error) => {
    if (__DEV__) {
      console.log('[Backup API Error] <-', error.response?.status, error.response?.data || error.message);
    }
    return Promise.reject(error);
  },
);

const adminApi = axios.create({
  baseURL: `${API_URL}/admin`,
  timeout: 30000,
});

adminApi.interceptors.request.use(async (request) => {
  await attachAuthToken(request);
  if (__DEV__) {
    console.log('[Admin API Request] ->', request.method?.toUpperCase(), `${request.baseURL}${request.url ?? ''}`);
  }
  return request;
});

adminApi.interceptors.response.use(
  (response) => {
    if (__DEV__) console.log('[Admin API Response] <- Success:', response.status);
    return response;
  },
  (error) => {
    if (__DEV__) {
      console.log('[Admin API Error] <-', error.response?.status, error.response?.data || error.message);
    }
    return Promise.reject(error);
  },
);

export { authApi, backupApi, adminApi };
export default api;
