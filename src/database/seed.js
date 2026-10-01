const db = require('./db');
const logger = require('../utils/logger');

function seedData() {
  const count = db.prepare('SELECT COUNT(*) as count FROM students').get().count;
  if (count > 0) {
    return; // Already seeded
  }

  logger.info('Seeding initial student records for demonstration...');

  const insertStudent = db.prepare(`
    INSERT INTO students (roll_number, name, email, department, mapped_mac, mapped_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const sampleStudents = [
    {
      roll: 'CS-2024-001',
      name: 'Aarav Sharma',
      email: 'aarav.sharma@college.edu',
      dept: 'Computer Science',
      mac: null, // Ready to auto-bind on first scan!
      notes: 'First time student'
    },
    {
      roll: 'CS-2024-002',
      name: 'Diya Patel',
      email: 'diya.patel@college.edu',
      dept: 'Computer Science',
      mac: null,
      notes: 'First time student'
    },
    {
      roll: 'CS-2024-003',
      name: 'Rohan Verma',
      email: 'rohan.verma@college.edu',
      dept: 'Computer Science',
      mac: '2A:32:AB:A5:AB:97', // Sample pre-mapped device
      notes: 'Registered device'
    },
    {
      roll: 'CS-2024-004',
      name: 'Ananya Iyer',
      email: 'ananya.iyer@college.edu',
      dept: 'Computer Science',
      mac: null,
      notes: 'First time student'
    },
    {
      roll: 'IT-2024-010',
      name: 'Kabir Mehta',
      email: 'kabir.mehta@college.edu',
      dept: 'Information Tech',
      mac: null,
      notes: 'First time student'
    },
    {
      roll: 'IT-2024-011',
      name: 'Sneha Reddy',
      email: 'sneha.reddy@college.edu',
      dept: 'Information Tech',
      mac: null,
      notes: 'First time student'
    },
    {
      roll: 'EC-2024-025',
      name: 'Vikram Joshi',
      email: 'vikram.joshi@college.edu',
      dept: 'Electronics',
      mac: null,
      notes: 'First time student'
    }
  ];

  const transaction = db.transaction((students) => {
    for (const s of students) {
      insertStudent.run(
        s.roll,
        s.name,
        s.email,
        s.dept,
        s.mac,
        s.mac ? new Date().toISOString() : null,
        s.notes
      );
    }
  });

  transaction(sampleStudents);
  logger.success(`Seeded ${sampleStudents.length} sample students successfully.`);
}

module.exports = { seedData };
