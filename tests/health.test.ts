import request from 'supertest';
import express from 'express';
import { healthRouter } from '../src/routes/health';

// Create a test app instance
const app = express();
app.use('/health', healthRouter);

describe('GET /health', () => {
     it('should return health status 200', async () => {
          const res = await request(app).get('/health');

          expect(res.status).toBe(200);
     });

     it('should return correct JSON structure', async () => {
          const res = await request(app).get('/health');

          expect(res.body).toEqual({
               status: 'ok',
               service: 'creditra-backend',
          });
     });

     it('should have content-type application/json', async () => {
          const res = await request(app).get('/health');

          expect(res.headers['content-type']).toMatch(/json/);
     });
});