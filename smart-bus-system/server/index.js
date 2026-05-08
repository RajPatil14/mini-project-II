import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import Driver from './models/Driver.js'
import Bus from './models/Bus.js'
import Trip from './models/Trip.js'
import Location from './models/Location.js'
import Attendance from './models/Attendance.js'
import multer from 'multer'
import { exec } from 'child_process'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import util from 'util'

const execPromise = util.promisify(exec)

const storage = multer.memoryStorage()
const upload = multer({ storage })

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '.env') })

const app = express()
app.use(cors())
app.use(express.json())

const getLocalNetworkIp = () => {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return 'localhost'
}

const PORT = process.env.PORT || 5000
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/smart-bus-system'
const FRONTEND_URL = process.env.FRONTEND_URL || `http://${getLocalNetworkIp()}:5173`

const routes = [
  { id: 'R1', name: 'Kolhapur to Sangli' },
  { id: 'R2', name: 'Sangli to Kolhapur' },
  { id: 'R3', name: 'Route 3 - City Loop' }
]

const buildSeedData = async () => {
  const driverCount = await Driver.countDocuments()
  const busCount = await Bus.countDocuments()

  if (driverCount > 0 || busCount > 0) {
    return
  }

  await Driver.create([
    { name: 'Prasad Bharmal', phone: '+918237917634', routeId: 'R1' },
    { name: 'Vishal Asabe', phone: '+918767059963', routeId: 'R1' },
    { name: 'Pranav Yadav', phone: '+919284572736', routeId: 'R1' },
    { name: 'Pranav Chougule', phone: '+917796487321', routeId: 'R1' },
    { name: 'Sai Kothwal', phone: '+919325897517', routeId: 'R1' },
    { name: 'Pranav Kamble', phone: '+917498302067', routeId: 'R2' },
    { name: 'Vivek Gudalkar', phone: '+918624862135', routeId: 'R2' },
    { name: 'Harshad Gurav', phone: '+919373166257', routeId: 'R2' },
    { name: 'Vedant Telsinge', phone: '+918177843484', routeId: 'R2' },
    { name: 'Devraj Vagare', phone: '+917498074387', routeId: 'R2' }
  ])

  await Bus.create([
    { number: 'BUS-101', routeId: 'R1' },
    { number: 'BUS-102', routeId: 'R1' },
    { number: 'BUS-201', routeId: 'R2' },
    { number: 'BUS-301', routeId: 'R3' }
  ])
}

app.get('/routes', (req, res) => {
  return res.json(routes)
})

app.get('/drivers/:routeId', async (req, res) => {
  const { routeId } = req.params
  const drivers = await Driver.find({ routeId }).sort('name')
  res.json(drivers)
})

app.get('/drivers/available/:routeId', async (req, res) => {
  const { routeId } = req.params
  const drivers = await Driver.find({
    routeId,
    status: 'free',
    attendanceStatus: 'present'
  }).sort('name')
  res.json(drivers)
})

app.get('/buses/available/:routeId', async (req, res) => {
  const { routeId } = req.params
  const buses = await Bus.find({ routeId, status: 'free' }).sort('number')
  res.json(buses)
})

app.get('/drivers/busy/:routeId', async (req, res) => {
  const { routeId } = req.params
  const drivers = await Driver.find({ routeId, status: 'busy' }).sort('name')
  res.json(drivers)
})

app.get('/drivers/present/:routeId', async (req, res) => {
  const { routeId } = req.params
  const drivers = await Driver.find({ routeId, attendanceStatus: 'present' }).sort('name')
  res.json(drivers)
})

app.get('/buses/busy/:routeId', async (req, res) => {
  const { routeId } = req.params
  const buses = await Bus.find({ routeId, status: 'busy' }).sort('number')
  res.json(buses)
})

app.get('/trip/:id', async (req, res) => {
  const trip = await Trip.findById(req.params.id)
    .populate('driverId busId')
    .lean()

  if (!trip) {
    return res.status(404).json({ message: 'Trip not found' })
  }

  res.json(trip)
})

app.post('/attendance', async (req, res) => {
  const { routeId, driverId } = req.body
  if (!routeId || !driverId) {
    return res.status(400).json({ message: 'routeId and driverId are required' })
  }

  const driver = await Driver.findById(driverId)
  if (!driver) {
    return res.status(404).json({ message: 'Driver not found' })
  }

  driver.attendanceStatus = 'present'
  await driver.save()

  const date = new Date().toISOString().split('T')[0]
  await Attendance.create({ driverId, routeId, date, status: 'present' })

  res.json({ message: 'Attendance recorded', driver })
})

app.post('/start-trip', async (req, res) => {
  const { routeId, driverId, busId } = req.body
  if (!routeId || !driverId || !busId) {
    return res.status(400).json({ message: 'routeId, driverId, and busId are required' })
  }

  const driver = await Driver.findById(driverId)
  const bus = await Bus.findById(busId)

  if (!driver || !bus) {
    return res.status(404).json({ message: 'Driver or bus not found' })
  }

  if (driver.routeId !== routeId || bus.routeId !== routeId) {
    return res.status(400).json({ message: 'Driver and bus must belong to the selected route' })
  }

  if (driver.status !== 'free' || driver.attendanceStatus !== 'present') {
    return res.status(400).json({ message: 'Driver must be present and free' })
  }

  if (bus.status !== 'free') {
    return res.status(400).json({ message: 'Bus must be free' })
  }

  const trip = await Trip.create({ routeId, driverId, busId })

  driver.status = 'busy'
  await driver.save()

  bus.status = 'busy'
  await bus.save()

  const trackingUrl = `${FRONTEND_URL}/track?tripId=${trip._id}`
  console.log(`SMS to ${driver.phone}: ${trackingUrl}`)

  res.json({
    message: 'Trip started',
    tripId: trip._id,
    trackingUrl,
    driver,
    bus
  })
})

app.post('/end-trip', async (req, res) => {
  const { tripId } = req.body
  if (!tripId) {
    return res.status(400).json({ message: 'tripId is required' })
  }

  const trip = await Trip.findById(tripId)
  if (!trip) {
    return res.status(404).json({ message: 'Trip not found' })
  }

  if (trip.status === 'completed') {
    return res.status(400).json({ message: 'Trip is already completed' })
  }

  const driver = await Driver.findById(trip.driverId)
  const bus = await Bus.findById(trip.busId)

  trip.status = 'completed'
  trip.endTime = new Date()
  await trip.save()

  if (driver) {
    driver.status = 'free'
    await driver.save()
  }

  if (bus) {
    bus.status = 'free'
    await bus.save()
  }

  res.json({ message: 'Trip ended', trip })
})

app.post('/free-resources', async (req, res) => {
  const { routeId, driverId, busId } = req.body
  if (!routeId || !driverId || !busId) {
    return res.status(400).json({ message: 'routeId, driverId, and busId are required' })
  }

  const driver = await Driver.findById(driverId)
  const bus = await Bus.findById(busId)

  if (!driver || !bus) {
    return res.status(404).json({ message: 'Driver or bus not found' })
  }

  if (driver.routeId !== routeId || bus.routeId !== routeId) {
    return res.status(400).json({ message: 'Driver and bus must belong to the selected route' })
  }

  driver.status = 'free'
  await driver.save()

  bus.status = 'free'
  await bus.save()

  res.json({ message: 'Driver and bus marked as free', driver, bus })
})

app.post('/check-out', async (req, res) => {
  const { driverId } = req.body
  if (!driverId) {
    return res.status(400).json({ message: 'driverId is required' })
  }

  const driver = await Driver.findById(driverId)
  if (!driver) {
    return res.status(404).json({ message: 'Driver not found' })
  }

  driver.attendanceStatus = 'absent'
  await driver.save()

  res.json({ message: 'Driver checked out successfully', driver })
})

app.post('/location/update', async (req, res) => {
  const { tripId, latitude, longitude } = req.body
  if (!tripId || latitude == null || longitude == null) {
    return res.status(400).json({ message: 'tripId, latitude, and longitude are required' })
  }

  const trip = await Trip.findById(tripId)
  if (!trip) {
    return res.status(404).json({ message: 'Trip not found' })
  }

  await Location.create({ tripId, latitude, longitude })
  res.json({ message: 'Location updated' })
})

app.post('/update-location', async (req, res) => {
  const data = req.body
  const { lat, lng, speed } = data

  if (lat == null || lng == null) {
    return res.status(400).json({ message: 'lat and lng are required' })
  }

  await Location.create({ 
    latitude: lat, 
    longitude: lng, 
    speed: speed || 40 
  })

  res.json({ message: 'Location updated' })
})

app.get('/get-location', async (req, res) => {
  const latest = await Location.findOne().sort({ timestamp: -1 }).lean()
  if (!latest) {
    return res.json({
      lat: 16.7440,
      lng: 74.4600,
      speed: 40
    })
  }
  res.json({
    lat: latest.latitude,
    lng: latest.longitude,
    speed: latest.speed || 40
  })
})

app.get('/seed', async (req, res) => {
  await buildSeedData()
  res.json({ message: 'Seed data created' })
})

app.get('/locations/active/:routeId', async (req, res) => {
  const { routeId } = req.params;
  try {
    const activeTrips = await Trip.find({ routeId, status: 'active' }).populate('busId');
    const tripLocations = [];

    for (const trip of activeTrips) {
      const latestLocation = await Location.findOne({ tripId: trip._id }).sort({ timestamp: -1 });
      if (latestLocation) {
        tripLocations.push({
          tripId: trip._id,
          busNumber: trip.busId?.number || 'Unknown',
          latitude: latestLocation.latitude,
          longitude: latestLocation.longitude,
          timestamp: latestLocation.timestamp
        });
      }
    }
    
    res.json(tripLocations);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching active locations', error: error.message });
  }
});

app.post('/extra-bus/evaluate', upload.array('images', 4), async (req, res) => {
const { routeId, manual_count } = req.body;

  if (!routeId) {
    return res.status(400).json({ message: 'routeId is required' });
  }

  // Ensure 4 images are uploaded
  if (!req.files || req.files.length !== 4) {
    return res.status(400).json({ message: 'Exactly 4 images are required' });
  }

  let passengerCount = 0;

  // Create temp dir
  const tempDir = path.join(os.tmpdir(), `yolo-${uuidv4()}`);
  await fs.mkdir(tempDir, { recursive: true });
  const imagePaths = [];

  try {
    // Save images to temp files
    for (let i = 0; i < req.files.length; i++) {
      const ext = path.extname(req.files[i].originalname) || '.jpg';
      const tempPath = path.join(tempDir, `img${i + 1}${ext}`);
      await fs.writeFile(tempPath, req.files[i].buffer);
      imagePaths.push(tempPath);
    }

    // Call YOLO script with image paths
    const command = `python "${path.join(__dirname, 'yolo_stub.py')}" ${imagePaths.map(p => `"${p}"`).join(' ')}`;
    const { stdout, stderr } = await execPromise(command);
    
    if (manual_count) {
      passengerCount = parseInt(manual_count);
    } else if (stdout) {
      passengerCount = parseInt(stdout.trim(), 10);
      if (isNaN(passengerCount)) passengerCount = 6;
    }
  } catch (err) {
    console.error('Error running YOLO script:', err);
    passengerCount = Math.floor(Math.random() * (110 - 60 + 1)) + 60;
  } finally {
    // Cleanup temp files
    try {
      for (const imgPath of imagePaths) {
        await fs.unlink(imgPath).catch(() => {});
      }
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    } catch (cleanupErr) {
      console.error('Temp cleanup failed:', cleanupErr);
    }
  }

  try {
    // Check for free drivers
    const freeDrivers = await Driver.find({
      routeId,
      status: 'free',
      attendanceStatus: 'present'
    });

    // Check for free buses
    const freeBuses = await Bus.find({ routeId, status: 'free' });

    const driverAvailable = freeDrivers.length > 0;
    const busAvailable = freeBuses.length > 0;

    let allocationStatus = 'Not Allocated';
    if (passengerCount >= 80 && driverAvailable && busAvailable) {
      allocationStatus = 'Extra Bus Approved';
    }

    res.json({
      passengerCount,
      driverAvailable,
      busAvailable,
      allocationStatus,
      availableDriversCount: freeDrivers.length,
      availableBusesCount: freeBuses.length
    });

  } catch (error) {
    res.status(500).json({ message: 'Error evaluating extra bus', error: error.message });
  }
});

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB')
    return buildSeedData()
  })
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`)
    })
  })
  .catch(error => {
    console.error('Database connection failed:', error)
    process.exit(1)
  })
