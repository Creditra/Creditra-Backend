import { CreditLineRepository } from '../repositories/interfaces/CreditLineRepository.js';
import { RiskEvaluationRepository } from '../repositories/interfaces/RiskEvaluationRepository.js';
import { TransactionRepository } from '../repositories/interfaces/TransactionRepository.js';
import { InMemoryCreditLineRepository } from '../repositories/memory/InMemoryCreditLineRepository.js';
import { InMemoryRiskEvaluationRepository } from '../repositories/memory/InMemoryRiskEvaluationRepository.js';
import { InMemoryTransactionRepository } from '../repositories/memory/InMemoryTransactionRepository.js';
import { CreditLineService } from '../services/CreditLineService.js';
import { RiskEvaluationService } from '../services/RiskEvaluationService.js';

export class Container {
  private static instance: Container;
  
  // Repositories
  private _creditLineRepository: CreditLineRepository;
  private _riskEvaluationRepository: RiskEvaluationRepository;
  private _transactionRepository: TransactionRepository;
  
  // Services
  private _creditLineService: CreditLineService;
  private _riskEvaluationService: RiskEvaluationService;

  private constructor() {
    // Initialize repositories (in-memory implementations for now)
    this._creditLineRepository = new InMemoryCreditLineRepository();
    this._riskEvaluationRepository = new InMemoryRiskEvaluationRepository();
    this._transactionRepository = new InMemoryTransactionRepository();
    
    // Initialize services
    this._creditLineService = new CreditLineService(this._creditLineRepository);
    this._riskEvaluationService = new RiskEvaluationService(this._riskEvaluationRepository);
  }

  public static getInstance(): Container {
    if (!Container.instance) {
      Container.instance = new Container();
    }
    return Container.instance;
  }

  // Repository getters
  get creditLineRepository(): CreditLineRepository {
    return this._creditLineRepository;
  }

  get riskEvaluationRepository(): RiskEvaluationRepository {
    return this._riskEvaluationRepository;
  }

  get transactionRepository(): TransactionRepository {
    return this._transactionRepository;
  }

  // Service getters
  get creditLineService(): CreditLineService {
    return this._creditLineService;
  }

  get riskEvaluationService(): RiskEvaluationService {
    return this._riskEvaluationService;
  }

  // Method to replace repositories (useful for testing or switching to DB implementations)
  public setRepositories(repositories: {
    creditLineRepository?: CreditLineRepository;
    riskEvaluationRepository?: RiskEvaluationRepository;
    transactionRepository?: TransactionRepository;
  }): void {
    if (repositories.creditLineRepository) {
      this._creditLineRepository = repositories.creditLineRepository;
      this._creditLineService = new CreditLineService(this._creditLineRepository);
    }
    
    if (repositories.riskEvaluationRepository) {
      this._riskEvaluationRepository = repositories.riskEvaluationRepository;
      this._riskEvaluationService = new RiskEvaluationService(this._riskEvaluationRepository);
    }
    
    if (repositories.transactionRepository) {
      this._transactionRepository = repositories.transactionRepository;
    }
  }
}