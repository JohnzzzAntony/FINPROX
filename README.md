# FinProx - Business Management System

FinProx is a comprehensive business management system for sales and procurement operations, featuring role-based access control and AI-powered insights, built with Firebase and modern web technologies.

## Features

- **Sales Management**: Quotations, invoices, client management
- **Procurement**: Purchase orders, vendor management, goods received notes
- **Financial Tracking**: Payments, outstanding balances, overdue monitoring
- **User Management**: Role-based access control (Admin, Manager, Staff)
- **PDF Generation**: Automatic document generation for quotes, invoices, LPOs, GRNs
- **Email Automation**: Automated notifications and document delivery
- **Real-time Sync**: Cloud-based data synchronization
- **Offline Mode**: Local storage fallback when offline
- **Mobile Apps**: Android and iOS apps via Capacitor

## Role-Based Access Control

- **Admin**: Full system access including user management, company settings, and financial overview
- **Manager**: Full business operations access with financial insights and approval workflows
- **Staff**: Limited access to personal tasks and assigned documents only

## Tech Stack

- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Backend**: Firebase (Authentication, Firestore, Cloud Functions, Hosting)
- **Libraries**: jsPDF, Font Awesome, Tailwind CSS
- **Mobile**: Capacitor for cross-platform mobile apps

## Project Structure

```
bussiness/
├── index.html          # Main HTML file
├── app.js             # Application logic
├── style.css          # Styles
├── firebase.json      # Firebase configuration
├── firestore.rules    # Firestore security rules
├── functions/         # Cloud Functions
│   ├── index.js
│   └── package.json
├── www/               # Web assets for mobile
├── android/           # Android app
└── .github/           # CI/CD workflows
```

## Setup Instructions

### 1. Firebase Setup

1. Create a new Firebase project at https://console.firebase.google.com/
2. Enable Authentication, Firestore, Functions, and Hosting
3. Update `app.js` with your Firebase config:
   ```javascript
   const FB_CFG = {
     apiKey: "your-api-key",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project-id",
     // ... other config
   };
   ```
4. Update `.firebaserc` with your project ID

### 2. Local Development

1. Install dependencies:
   ```bash
   npm install
   cd functions && npm install
   ```

2. Start local development:
   ```bash
   firebase serve
   ```

### 3. Deployment

1. Login to Firebase:
   ```bash
   firebase login
   ```

2. Deploy:
   ```bash
   firebase deploy
   ```

### 4. Mobile Apps

1. Install Capacitor:
   ```bash
   npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
   ```

2. Build and sync:
   ```bash
   npx cap sync
   ```

3. Open in Android Studio:
   ```bash
   npx cap open android
   ```

## Usage

1. **Demo Mode**: Click "Quick Demo" to explore all features without registration
2. **Registration**: Create an account to start managing your business
3. **Navigation**: Use the sidebar to access different modules
4. **Role-based Access**: Different permissions for Admin, Manager, and Staff users

## Security Rules

Firestore security rules ensure that users can only access data from their company. Cloud Functions handle automated workflows like overdue invoice notifications.

## API Documentation

### Cloud Functions

- `checkOverdueInvoices`: Daily cron job to mark overdue invoices
- `sendEmailNotification`: Send email notifications for documents
- `processGoodsReceived`: Update LPO status when GRN is created
- `generateReport`: Generate PDF reports (placeholder)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes
4. Submit a pull request

## License

ISC License

## Support

For support, please contact the development team or create an issue in the repository.