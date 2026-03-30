import request from 'supertest';
import express from 'express';
import { creditRouter } from '../src/routes/credit.js';
import { Container } from '../src/container/Container.js';
import { CreditLineStatus } from '../src/models/CreditLine.js';

const app = express();
app.use(express.json());
app.use('/api/credit', creditRouter);

describe('POST /api/credit/lines/:id/draw', () => {
     let container: Container;
     let lineId: string;
     const walletAddress = 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S1';

     beforeEach(async () => {
          container = Container.getInstance();
          // Clear repository
          if ((container.creditLineRepository as any).clear) {
               (container.creditLineRepository as any).clear();
          }

          const line = await container.creditLineService.createCreditLine({
               walletAddress,
               creditLimit: '1000',
               interestRateBps: 500
          });
          lineId = line.id;
     });

     it('should draw successfully', async () => {
          const res = await request(app)
               .post(`/api/credit/lines/${lineId}/draw`)
               .send({ borrowerId: walletAddress, amount: '200' });

          expect(res.status).toBe(200);
          expect(res.body.data.creditLine.utilized).toBe('200');
     });

     it('should reject over-limit draw', async () => {
          const res = await request(app)
               .post(`/api/credit/lines/${lineId}/draw`)
               .send({ borrowerId: walletAddress, amount: '2000' });

          expect(res.status).toBe(400);
     });

     it('should reject wrong borrower', async () => {
          const res = await request(app)
               .post(`/api/credit/lines/${lineId}/draw`)
               .send({ borrowerId: 'GBAHQCUPC7G2B4D2F2I2K2M2O2Q2S2U2W2Y2A2C2E2G2I2K2M2O2Q2S2', amount: '100' });

          expect(res.status).toBe(403);
     });

     it('should reject inactive credit line', async () => {
          await container.creditLineService.updateCreditLine(lineId, {
               status: CreditLineStatus.CLOSED
          });

          const res = await request(app)
               .post(`/api/credit/lines/${lineId}/draw`)
               .send({ borrowerId: walletAddress, amount: '100' });

          expect(res.status).toBe(400);
     });

     it('should return 404 if credit line not found', async () => {
          const res = await request(app)
               .post('/api/credit/lines/unknown/draw')
               .send({ borrowerId: walletAddress, amount: '100' });

          expect(res.status).toBe(404);
     });

     it('should reject invalid amount', async () => {
          const res = await request(app)
               .post(`/api/credit/lines/${lineId}/draw`)
               .send({ borrowerId: walletAddress, amount: '-50' });

          expect(res.status).toBe(400);
     });

     it('should reject zero amount', async () => {
          const res = await request(app)
               .post(`/api/credit/lines/${lineId}/draw`)
               .send({ borrowerId: walletAddress, amount: '0' });

          expect(res.status).toBe(400);
     });

     it('should fail if body missing', async () => {
          const res = await request(app)
               .post(`/api/credit/lines/${lineId}/draw`)
               .send({});

          expect(res.status).toBe(400); // Changed from 403 to 400 because Zod catches it first
     });
});