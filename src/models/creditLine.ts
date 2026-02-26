/**
 * @openapi
 * components:
 *   schemas:
 *     CreditLineStatus:
 *       type: string
 *       enum: [active, suspended, closed]
 *       description: Lifecycle state of the credit line.
 *
 *     CreditLine:
 *       type: object
 *       required:
 *         - id
 *         - borrowerId
 *         - limitCents
 *         - utilizedCents
 *         - interestRateBps
 *         - riskScore
 *         - status
 *         - createdAt
 *         - updatedAt
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           description: Unique identifier for the credit line.
 *         borrowerId:
 *           type: string
 *           format: uuid
 *           description: Identifier of the borrower who owns this credit line.
 *         limitCents:
 *           type: integer
 *           minimum: 0
 *           description: Total approved credit limit in cents (USD).
 *         utilizedCents:
 *           type: integer
 *           minimum: 0
 *           description: Amount currently drawn down, in cents.
 *         interestRateBps:
 *           type: integer
 *           minimum: 0
 *           description: Annual interest rate expressed in basis points (e.g. 1250 = 12.50%).
 *         riskScore:
 *           type: number
 *           format: float
 *           minimum: 0
 *           maximum: 1
 *           description: Model-derived risk score between 0 (lowest risk) and 1 (highest risk).
 *         status:
 *           $ref: '#/components/schemas/CreditLineStatus'
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

export enum CreditLineStatus {
    Active = 'active',
    Suspended = 'suspended',
    Closed = 'closed',
  }
  
  export interface CreditLine {
    /** UUID — primary key */
    id: string;
    /** UUID of the borrower */
    borrowerId: string;
    /** Total approved limit in cents */
    limitCents: number;
    /** Amount currently drawn, in cents */
    utilizedCents: number;
    /** Annual interest rate in basis points */
    interestRateBps: number;
    /** Risk score: 0.00–1.00 */
    riskScore: number;
    status: CreditLineStatus;
    createdAt: Date;
    updatedAt: Date;
  }