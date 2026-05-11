const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

// Daily trigger to check for overdue invoices
exports.checkOverdueInvoices = functions.pubsub.schedule('0 9 * * *').onRun(async (context) => {
  const db = admin.firestore();
  const today = new Date().toISOString().split('T')[0];
  
  try {
    const companiesSnapshot = await db.collection('companies').get();
    
    for (const companyDoc of companiesSnapshot.docs) {
      const companyId = companyDoc.id;
      const invoicesRef = db.collection('companies').doc(companyId).collection('invoices');
      
      const overdueInvoices = await invoicesRef
        .where('status', 'in', ['unpaid', 'partial'])
        .where('dueDate', '<', today)
        .get();
      
      for (const invoiceDoc of overdueInvoices.docs) {
        const invoice = invoiceDoc.data();
        if (invoice.status !== 'overdue') {
          await invoiceDoc.ref.update({ status: 'overdue' });
          
          // Send notification email (placeholder - integrate with email service)
          console.log(`Invoice ${invoice.id} marked as overdue for company ${companyId}`);
        }
      }
    }
    
    console.log('Overdue invoice check completed');
    return null;
  } catch (error) {
    console.error('Error checking overdue invoices:', error);
    return null;
  }
});

// Function to send email notifications (placeholder - integrate with SendGrid, Mailgun, etc.)
exports.sendEmailNotification = functions.firestore
  .document('companies/{companyId}/{collection}/{documentId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    const collection = context.params.collection;
    
    // Send email based on document type
    if (collection === 'quotations' && data.status === 'sent') {
      // Send quotation email
      console.log(`Sending quotation email for ${data.id}`);
    } else if (collection === 'lpos' && data.status === 'awaiting_delivery') {
      // Send LPO email
      console.log(`Sending LPO email for ${data.id}`);
    } else if (collection === 'invoices' && data.status === 'overdue') {
      // Send overdue invoice reminder
      console.log(`Sending overdue reminder for ${data.id}`);
    }
    
    return null;
  });

// Workflow automation for GRN creation
exports.processGoodsReceived = functions.firestore
  .document('companies/{companyId}/grns/{grnId}')
  .onCreate(async (snap, context) => {
    const grn = snap.data();
    const companyId = context.params.companyId;
    const db = admin.firestore();
    
    try {
      // Update LPO status based on GRN
      if (grn.lpoId) {
        const lpoRef = db.collection('companies').doc(companyId).collection('lpos').doc(grn.lpoId);
        const lpoDoc = await lpoRef.get();
        
        if (lpoDoc.exists) {
          const lpo = lpoDoc.data();
          // Logic to update LPO status based on GRN items
          const allReceived = grn.items.every(item => item.received >= item.ordered);
          await lpoRef.update({ 
            status: allReceived ? 'received' : 'partially_received' 
          });
        }
      }
      
      console.log(`GRN ${grn.id} processed successfully`);
      return null;
    } catch (error) {
      console.error('Error processing GRN:', error);
      return null;
    }
  });

// Function to generate PDF reports (placeholder)
exports.generateReport = functions.https.onCall(async (data, context) => {
  // Generate PDF reports for various business needs
  // Integrate with PDF generation libraries
  
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  
  const { reportType, companyId } = data;
  
  // Generate report based on type
  console.log(`Generating ${reportType} report for company ${companyId}`);
  
  return { success: true, message: 'Report generated' };
});