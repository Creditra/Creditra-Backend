import { type CreditLineRepository } from "../repositories/interfaces/CreditLineRepository.js";
import { type RiskEvaluationRepository } from "../repositories/interfaces/RiskEvaluationRepository.js";
import { type TransactionRepository } from "../repositories/interfaces/TransactionRepository.js";
import { InMemoryCreditLineRepository } from "../repositories/memory/InMemoryCreditLineRepository.js";
import { InMemoryRiskEvaluationRepository } from "../repositories/memory/InMemoryRiskEvaluationRepository.js";
import { InMemoryTransactionRepository } from "../repositories/memory/InMemoryTransactionRepository.js";
import { PostgresCreditLineRepository } from "../repositories/postgres/PostgresCreditLineRepository.js";
import { CreditLineService } from "../services/CreditLineService.js";
import { RiskEvaluationService } from "../services/RiskEvaluationService.js";
import { getConnection, type DbClient } from "../db/client.js";

export class Container {
  private static instance: Container;

  // Database client
  private _dbClient: DbClient | null = null;

  // Repositories
  private _creditLineRepository!: CreditLineRepository;
  private _riskEvaluationRepository!: RiskEvaluationRepository;
  private _transactionRepository!: TransactionRepository;

  // Services
  private _creditLineService: CreditLineService;
  private _riskEvaluationService: RiskEvaluationService;

  private constructor() {
    // Initialize database client if DATABASE_URL is available
    if (process.env.DATABASE_URL) {
      try {
        this._dbClient = getConnection();
        console.log("[Container] Using PostgreSQL for credit lines, in-memory for others");
        
        // Initialize PostgreSQL repository only for credit lines
        this._creditLineRepository = new PostgresCreditLineRepository(this._dbClient);
        // Keep in-memory for other repositories
        this._riskEvaluationRepository = new InMemoryRiskEvaluationRepository();
        this._transactionRepository = new InMemoryTransactionRepository();
      } catch (error) {
        console.warn("[Container] Failed to initialize PostgreSQL, falling back to in-memory:", error);
        this._dbClient = null;
        this.initializeInMemoryRepositories();
      }
    } else {
      console.log("[Container] Using in-memory repositories (no DATABASE_URL)");
      this.initializeInMemoryRepositories();
    }

    // Initialize services
    this._creditLineService = new CreditLineService(this._creditLineRepository);
    this._riskEvaluationService = new RiskEvaluationService(
      this._riskEvaluationRepository,
    );
  }

  private initializeInMemoryRepositories(): void {
    this._creditLineRepository = new InMemoryCreditLineRepository();
    this._riskEvaluationRepository = new InMemoryRiskEvaluationRepository();
    this._transactionRepository = new InMemoryTransactionRepository();
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
      this._creditLineService = new CreditLineService(
        this._creditLineRepository,
      );
    }

    if (repositories.riskEvaluationRepository) {
      this._riskEvaluationRepository = repositories.riskEvaluationRepository;
      this._riskEvaluationService = new RiskEvaluationService(
        this._riskEvaluationRepository,
      );
    }

    if (repositories.transactionRepository) {
      this._transactionRepository = repositories.transactionRepository;
    }
  }

  /**
   * Shutdown internal services and close database connections.
   */
  public async shutdown(): Promise<void> {
    console.log("[Container] Shutting down internal services...");

    // Close database connection if exists
    if (this._dbClient) {
      try {
        await this._dbClient.end();
        console.log("[Container] Database connection closed");
      } catch (error) {
        console.error("[Container] Error closing database connection:", error);
      }
    }

    console.log("[Container] All services shut down.");
  }
}
