import axios from 'axios'
const api = axios.create({ baseURL: '/api' })
export default api
export const getHardware = () => api.get('/hardware').then(r=>r.data)
export const getModels = (params) => api.get('/models', { params }).then(r=>r.data)
export const getModel = (id) => api.get(`/models/${id}`).then(r=>r.data)
export const estimate = (p) => api.post('/estimate', null, { params: p }).then(r=>r.data)
export const downloadModel = (id) => api.post(`/models/${id}/download`).then(r=>r.data)
export const pauseModelDownload = (id) => api.post(`/models/${id}/download/pause`).then(r=>r.data)
export const getModelDownloadStatus = (id) => api.get(`/models/${id}/download/status`).then(r=>r.data)
export const listModelDownloads = () => api.get('/models/downloads').then(r=>r.data)
export const generate = (p) => api.post('/generate', p).then(r=>r.data)
export const getJobs = () => api.get('/jobs').then(r=>r.data)
export const getJob = (id) => api.get(`/jobs/${id}`).then(r=>r.data)
export const getVideos = () => api.get('/videos').then(r=>r.data)
export const uploadImage = (file) => {
  const fd = new FormData(); fd.append('file', file)
  return api.post('/upload-image', fd).then(r=>r.data)
}
export const postTelemetry = (event, meta) => api.post('/telemetry', { event, meta }).then(r=>r.data).catch(()=>{})
export const getTelemetryStats = () => api.get('/telemetry/stats').then(r=>r.data)
