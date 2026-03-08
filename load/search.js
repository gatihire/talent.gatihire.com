import http from 'k6/http'
import { check } from 'k6'

export let options = {
  stages: [
    { duration: '30s', target: 100 },
    { duration: '1m', target: 1000 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<600'], // ms
    http_req_failed: ['rate<0.01'],  // 1 %
  },
}

export default function () {
  const res = http.get('https://yourdomain.com/api/public/jobs/search?text=react')
  check(res, {
    'status is 200': (r) => r.status === 200,
    'has jobs': (r) => JSON.parse(r.body).jobs.length > 0,
  })
}