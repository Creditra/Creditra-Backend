import { Router, Request, Response } from 'express';
import { ICreditLineRepository, MockCreditLineRepository } from '../repositories/creditLineRepository.js';

export const creditRouter = Router();
const repository: ICreditLineRepository = new MockCreditLineRepository();

/**
 * @openapi
 * /api/credit/lines:
 *   get:
 *     summary: Get all credit lines
 *     description: Retrieve a list of all active, suspended, and closed credit lines.
 *     responses:
 *       200:
 *         description: A list of credit lines.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 creditLines:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         description: Unique identifier of the credit line
 *                       borrower:
 *                         type: string
 *                         description: Identifier of the borrower
 *                       limit:
 *                         type: number
 *                         description: Total credit limit
 *                       utilized:
 *                         type: number
 *                         description: Amount of credit currently utilized
 *                       interestRateBps:
 *                         type: number
 *                         description: Interest rate in basis points (1 bps = 0.01%)
 *                       riskScore:
 *                         type: number
 *                         description: Risk score associated with the borrower/line
 *                       status:
 *                         type: string
 *                         description: Status of the credit line (e.g., active, suspended, closed)
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       updatedAt:
 *                         type: string
 *                         format: date-time
 *       500:
 *         description: Internal server error
 */
creditRouter.get('/lines', async (_req: Request, res: Response): Promise<void> => {
  try {
    const lines = await repository.findAll();
    res.status(200).json({ creditLines: lines });
  } catch (error) {
    console.error('Failed to fetch credit lines:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * @openapi
 * /api/credit/lines/{id}:
 *   get:
 *     summary: Get a specific credit line by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: The credit line details
 *       404:
 *         description: Credit line not found
 *       500:
 *         description: Internal server error
 */
creditRouter.get('/lines/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const line = await repository.findById(req.params.id);
    if (!line) {
      res.status(404).json({ error: 'Credit line not found', id: req.params.id });
      return;
    }
    res.status(200).json({ creditLine: line });
  } catch (error) {
    console.error('Failed to fetch credit line by id:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

