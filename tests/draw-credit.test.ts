import request from 'supertest';
import express from 'express';
import { creditRouter } from '../src/routes/credit.js';
import { creditLines } from '../src/models/creditLineStore.js';

const app = express();
app.use(express.json());
app.use('/api/credit', creditRouter);

describe('POST /api/credit/lines/:id/draw', () => {
     beforeEach(() => {
          creditLines[0].utilized = 0;
          creditLines[0].status = 'Active';
     });

     it('should draw successfully', async () => {
          const res = await request(app)
               .post('/api/credit/lines/line-1/draw')
               .send({ borrowerId: 'user-1', amount: 200 });

          expect(res.status).toBe(200);
          expect(res.body.creditLine.utilized).toBe(200);
     });

     it('should reject over-limit draw', async () => {
          const res = await request(app)
               .post('/api/credit/lines/line-1/draw')
               .send({ borrowerId: 'user-1', amount: 2000 });

          expect(res.status).toBe(400);
     });

     it('should reject wrong borrower', async () => {
          const res = await request(app)
               .post('/api/credit/lines/line-1/draw')
               .send({ borrowerId: 'hacker', amount: 100 });

          expect(res.status).toBe(403);
     });

     it('should reject inactive credit line', async () => {
          creditLines[0].status = 'Closed';

          const res = await request(app)
               .post('/api/credit/lines/line-1/draw')
               .send({ borrowerId: 'user-1', amount: 100 });

          expect(res.status).toBe(400);
     });

     it('should return 404 if credit line not found', async () => {
          const res = await request(app)
               .post('/api/credit/lines/unknown/draw')
               .send({ borrowerId: 'user-1', amount: 100 });

          expect(res.status).toBe(404);
     });

     it('should reject invalid amount', async () => {
          const res = await request(app)
               .post('/api/credit/lines/line-1/draw')
               .send({ borrowerId: 'user-1', amount: -50 });

          expect(res.status).toBe(400);
     });

     it('should reject zero amount', async () => {
          const res = await request(app)
               .post('/api/credit/lines/line-1/draw')
               .send({ borrowerId: 'user-1', amount: 0 });

          expect(res.status).toBe(400);
     });

     it('should fail if body missing', async () => {
          const res = await request(app)
               .post('/api/credit/lines/line-1/draw')
               .send({});

          expect(res.status).toBe(403);
     });
});