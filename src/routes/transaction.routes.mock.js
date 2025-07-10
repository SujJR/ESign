const express = require('express');
const router = express.Router();

// Mock transaction data for testing
const mockTransactions = new Map();
let transactionCounter = 1;

// Mock responses for testing
const createMockTransaction = (data) => ({
  _id: `mock-id-${Date.now()}`,
  transactionId: data.transactionId || `MOCK-TXN-${transactionCounter++}`,
  documentId: data.documentId || 'mock-document-id',
  status: 'initiated',
  participants: data.participants || [],
  transactionDetails: data.transactionDetails || {},
  reminderSettings: data.reminderSettings || { enabled: true, frequency: 'weekly', maxReminders: 3 },
  notes: data.notes || '',
  tags: data.tags || [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  isActive: true,
  mockData: true
});

// POST /api/transactions - Create transaction
router.post('/', (req, res) => {
  try {
    const transaction = createMockTransaction(req.body);
    mockTransactions.set(transaction.transactionId, transaction);
    
    res.status(201).json({
      success: true,
      message: 'Transaction created successfully (MOCK DATA)',
      data: transaction,
      note: 'This is mock data - real implementation ready when database is connected'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create transaction',
      error: error.message
    });
  }
});

// GET /api/transactions - List transactions
router.get('/', (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    
    let transactions = Array.from(mockTransactions.values());
    
    // Add some default mock data if empty
    if (transactions.length === 0) {
      const defaultTransactions = [
        createMockTransaction({
          transactionId: 'MOCK-TXN-001',
          documentId: 'doc-001',
          status: 'completed',
          participants: [{ name: 'John Doe', email: 'john@example.com', role: 'signer', status: 'signed' }],
          notes: 'Sample completed transaction'
        }),
        createMockTransaction({
          transactionId: 'MOCK-TXN-002', 
          documentId: 'doc-002',
          status: 'out_for_signature',
          participants: [{ name: 'Jane Smith', email: 'jane@example.com', role: 'signer', status: 'sent' }],
          notes: 'Sample pending transaction'
        })
      ];
      
      defaultTransactions.forEach(txn => {
        mockTransactions.set(txn.transactionId, txn);
      });
      
      transactions = defaultTransactions;
    }
    
    // Filter by status if provided
    if (status) {
      transactions = transactions.filter(txn => txn.status === status);
    }
    
    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedTransactions = transactions.slice(startIndex, endIndex);
    
    res.json({
      success: true,
      message: 'Transactions retrieved successfully (MOCK DATA)',
      data: {
        docs: paginatedTransactions,
        totalDocs: transactions.length,
        page: parseInt(page),
        totalPages: Math.ceil(transactions.length / limit),
        hasNextPage: endIndex < transactions.length,
        hasPrevPage: page > 1
      },
      note: 'This is mock data - real implementation ready when database is connected'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get transactions',
      error: error.message
    });
  }
});

// GET /api/transactions/analytics - Get analytics
router.get('/analytics', (req, res) => {
  try {
    const transactions = Array.from(mockTransactions.values());
    
    const analytics = {
      summary: {
        totalTransactions: transactions.length + 10, // Add some mock count
        completedTransactions: Math.floor((transactions.length + 10) * 0.7),
        pendingTransactions: Math.floor((transactions.length + 10) * 0.2),
        expiredTransactions: Math.floor((transactions.length + 10) * 0.05),
        cancelledTransactions: Math.floor((transactions.length + 10) * 0.05),
        averageCompletionTime: 172800000 // 2 days in milliseconds
      },
      statusBreakdown: [
        { _id: 'completed', count: 7 },
        { _id: 'out_for_signature', count: 2 },
        { _id: 'initiated', count: 1 },
        { _id: 'expired', count: 1 }
      ]
    };
    
    res.json({
      success: true,
      message: 'Analytics retrieved successfully (MOCK DATA)',
      data: analytics,
      note: 'This is mock data - real implementation ready when database is connected'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get analytics',
      error: error.message
    });
  }
});

// GET /api/transactions/:transactionId - Get transaction details
router.get('/:transactionId', (req, res) => {
  try {
    const { transactionId } = req.params;
    const transaction = mockTransactions.get(transactionId);
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
        note: 'This is mock data - real implementation ready when database is connected'
      });
    }
    
    res.json({
      success: true,
      message: 'Transaction details retrieved successfully (MOCK DATA)',
      data: {
        transaction,
        adobeSignStatus: {
          status: 'OUT_FOR_SIGNATURE',
          message: 'Mock Adobe Sign status - real integration ready'
        }
      },
      note: 'This is mock data - real implementation ready when database is connected'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get transaction details',
      error: error.message
    });
  }
});

// POST /api/transactions/:transactionId/reminder - Send reminder
router.post('/:transactionId/reminder', (req, res) => {
  try {
    const { transactionId } = req.params;
    const { participantEmail, customMessage } = req.body;
    
    const transaction = mockTransactions.get(transactionId);
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Reminder sent successfully (MOCK)',
      data: {
        transactionId,
        participantEmail: participantEmail || 'all participants',
        customMessage: customMessage || 'Default reminder message',
        reminderSent: true,
        timestamp: new Date().toISOString()
      },
      note: 'This is mock data - real implementation ready when database is connected'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to send reminder',
      error: error.message
    });
  }
});

// GET /api/transactions/:transactionId/status - Check status
router.get('/:transactionId/status', (req, res) => {
  try {
    const { transactionId } = req.params;
    const transaction = mockTransactions.get(transactionId);
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Transaction status retrieved successfully (MOCK)',
      data: {
        transactionId,
        currentStatus: transaction.status,
        lastUpdated: transaction.updatedAt,
        participants: transaction.participants,
        adobeSignStatus: {
          status: 'OUT_FOR_SIGNATURE',
          message: 'Mock Adobe Sign status'
        }
      },
      note: 'This is mock data - real implementation ready when database is connected'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to check transaction status',
      error: error.message
    });
  }
});

module.exports = router;
