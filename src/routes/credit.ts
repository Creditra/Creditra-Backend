import { Router } from 'express';
import { Container } from '../container/Container.js';

export const creditRouter = Router();
const container = Container.getInstance();

creditRouter.get('/lines', async (req, res) => {
  try {
    const { offset, limit } = req.query;
    const offsetNum = offset ? parseInt(offset as string) : undefined;
    const limitNum = limit ? parseInt(limit as string) : undefined;
    
    const creditLines = await container.creditLineService.getAllCreditLines(offsetNum, limitNum);
    const total = await container.creditLineService.getCreditLineCount();
    
    res.json({ 
      creditLines,
      pagination: {
        total,
        offset: offsetNum || 0,
        limit: limitNum || 100
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch credit lines' });
  }
});

creditRouter.get('/lines/:id', async (req, res) => {
  try {
    const creditLine = await container.creditLineService.getCreditLine(req.params.id);
    
    if (!creditLine) {
      return res.status(404).json({ error: 'Credit line not found', id: req.params.id });
    }
    
    res.json(creditLine);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch credit line' });
  }
});

creditRouter.post('/lines', async (req, res) => {
  try {
    const { walletAddress, creditLimit, interestRateBps } = req.body;
    
    if (!walletAddress || !creditLimit || interestRateBps === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields: walletAddress, creditLimit, interestRateBps' 
      });
    }
    
    const creditLine = await container.creditLineService.createCreditLine({
      walletAddress,
      creditLimit,
      interestRateBps
    });
    
    res.status(201).json(creditLine);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create credit line';
    res.status(400).json({ error: message });
  }
});

creditRouter.put('/lines/:id', async (req, res) => {
  try {
    const { creditLimit, interestRateBps, status } = req.body;
    
    const creditLine = await container.creditLineService.updateCreditLine(req.params.id, {
      creditLimit,
      interestRateBps,
      status
    });
    
    if (!creditLine) {
      return res.status(404).json({ error: 'Credit line not found', id: req.params.id });
    }
    
    res.json(creditLine);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update credit line';
    res.status(400).json({ error: message });
  }
});

creditRouter.delete('/lines/:id', async (req, res) => {
  try {
    const deleted = await container.creditLineService.deleteCreditLine(req.params.id);
    
    if (!deleted) {
      return res.status(404).json({ error: 'Credit line not found', id: req.params.id });
    }
    
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete credit line' });
  }
});

creditRouter.get('/wallet/:walletAddress/lines', async (req, res) => {
  try {
    const creditLines = await container.creditLineService.getCreditLinesByWallet(req.params.walletAddress);
    res.json({ creditLines });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch credit lines for wallet' });
  }
});
