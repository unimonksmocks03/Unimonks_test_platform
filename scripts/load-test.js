import http from 'k6/http';
import { check, sleep } from 'k6';

// Configuration
export const options = {
    stages: [
        { duration: '30s', target: 50 },  // Ramp up to 50 users
        { duration: '1m', target: 50 },   // Stay at 50 users
        { duration: '30s', target: 100 }, // Ramp to 100 users
        { duration: '1m', target: 100 },  // Stay at 100
        { duration: '30s', target: 0 },   // Ramp down
    ],
    thresholds: {
        http_req_duration: ['p(95)<500'], // 95% of requests must complete below 500ms
        http_req_failed: ['rate<0.01'],   // Error rate should be less than 1%
    },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3000';

export default function arenaLoadTest() {
    // Run with:
    // k6 run -e API_URL=http://localhost:3000 -e AUTH_TOKEN=your_token -e SESSION_ID=uuid -e QUESTION_IDS=q1,q2,q3 scripts/load-test.js
    const token = __ENV.AUTH_TOKEN || 'missing_token';
    const sessionId = __ENV.SESSION_ID || '123e4567-e89b-12d3-a456-426614174000';
    const questionIds = (__ENV.QUESTION_IDS || 'q1,q2,q3')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

    const headers = { 
        'Content-Type': 'application/json',
        'Cookie': `access_token=${token}` 
    };

    // 2. Simulate periodic batch autosave.
    const savePayload = JSON.stringify({
        answers: questionIds.slice(0, 2).map((questionId, index) => ({
            questionId,
            optionId: ['A', 'B', 'C', 'D'][index % 4],
        })),
    });

    const saveRes = http.post(`${BASE_URL}/api/arena/${sessionId}/batch-answer`, savePayload, { headers });
    check(saveRes, {
        'auto-save status is 200': (r) => r.status === 200,
    });
    
    // Simulating user think time
    sleep(1);

    // 3. Simulate final test submission
    if (Math.random() < 0.1) { // 10% of iterations do a full submit to avoid overwhelming with submits
        const submitPayload = JSON.stringify({
             answers: questionIds.map((questionId, index) => ({
                 questionId,
                 optionId: ['A', 'B', 'C', 'D'][index % 4],
             })),
        });
        
        const submitRes = http.post(`${BASE_URL}/api/arena/${sessionId}/submit`, submitPayload, { headers });
        check(submitRes, {
            'submit status is 200': (r) => r.status === 200,
        });
    }

    sleep(2);
}
