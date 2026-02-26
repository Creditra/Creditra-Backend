import { Router, Request, Response } from 'express';
import { creditLineRepository, ICreditLineRepository } from '../repositories/creditLineRepository.js';

/**
 * Factory so tests can inject a mock repository without touching the module
 * singleton. Production callers omit the argument and get the real singleton.
 */
export function createCreditRouter(
  repo: ICreditLineRepository = creditLineRepository,
): Router {
  const router = Router();

  /**
   * @openapi
   * /api/credit/lines:
   *   get:
   *     summary: List all credit lines
   *     description: Returns every credit line in the system ordered by creation date (newest first).
   *     tags:
   *       - Credit
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
   *                     $ref: '#/components/schemas/CreditLine'
   *       500:
   *         description: Internal server error.
   */
  router.get('/lines', async (_req: Request, res: Response): Promise<void> => {
    try {
      const creditLines = await repo.findAll();

      // Newest first
      creditLines.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );

      res.status(200).json({ creditLines });
    } catch (err) {
      console.error('[GET /api/credit/lines]', err);
      res.status(500).json({ error: 'Failed to retrieve credit lines' });
    }
  });

  /**
   * @openapi
   * /api/credit/lines/{id}:
   *   get:
   *     summary: Get a single credit line by ID
   *     tags:
   *       - Credit
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         description: The credit line UUID.
   *     responses:
   *       200:
   *         description: The requested credit line.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/CreditLine'
   *       404:
   *         description: Credit line not found.
   */
  router.get('/lines/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const creditLine = await repo.findById(req.params.id);

      if (!creditLine) {
        res.status(404).json({ error: 'Credit line not found', id: req.params.id });
        return;
      }

      res.status(200).json({ creditLine });
    } catch (err) {
      console.error('[GET /api/credit/lines/:id]', err);
      res.status(500).json({ error: 'Failed to retrieve credit line' });
    }
  });

  return router;
}

// Default export used by src/index.ts
export const creditRouter = createCreditRouter();