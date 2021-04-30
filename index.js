let express = require('express')
let fs = require('fs')
let cors = require('cors')
let gpio = require('onoff').Gpio
var moment = require('moment'); // require
moment().format(); 

const gpioMapping = {"stations": [
	{"pin": 17, "station": 1},
	{"pin": 18, "station": 2},
	{"pin": 27, "station": 3},
	{"pin": 22, "station": 4},
	{"pin": 23, "station": 5},
	{"pin": 24, "station": 6},
	{"pin": 25, "station": 7},
	{"pin": 4, "station": 8}
]}

let stations = []
gpioMapping.stations.forEach((station)=>{
	stations.push({
		station: station.station,
		gpioPin: new gpio(station.pin, 'out'),
	})
})
function writeStation(stationIndex, value) {
	stations[stationIndex].gpioPin.writeSync(value)
}


const app = express()
const port = 3000
let stationStates = [false,false,false,false,false,false,false,false]
let stationsOn = 0
const timeGapBetweenFirings = 3000 //time in milliseconds between turning on stations to avoid pulling to much power at once
const maxStationsOn = 2

const days = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday'
]

app.use(express.json())
app.use(express.urlencoded({extended: false}))
app.use(cors())

/*
app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept")
    next()
})*/
let scheduleRaw = fs.readFileSync('schedule.json')
let workingSchedule = JSON.parse(scheduleRaw)

//Set all station states to off
Object.keys(workingSchedule).forEach((stationKey)=>{
    workingSchedule[stationKey].on = false
})
saveScheduleFile()

setInterval(reviewSchedule, 5000)
function reviewSchedule() {
    let stationStatesTest = [false,false,false,false,false,false,false,false]
    let now = moment()
    Object.keys(workingSchedule).forEach((stationKey)=>{
        days.forEach((dayKey)=>{
            workingSchedule[stationKey][dayKey].forEach((stationEvent)=>{
                const startTime = stationEvent.startTime
                const duration = parseInt( stationEvent.duration )
                if( timeInRange(dayKey, startTime, duration, now) ) {
                    stationStatesTest[ parseInt(workingSchedule[stationKey].number)-1 ] = true
                }
            })
        })
    })

    stationStatesTest.forEach((isOn, stationIndex)=>{
        if(isOn) {
            stationOn(parseInt(stationIndex))
        } else {
            stationOff(stationIndex)
        }
    })
}
function timeInRange(day, startTime, duration, testTime) {
    // testTime = moment("2021-04-29 00:09", "YYYY-MM-DD HH:mm")
    let start = moment(startTime, "HH:mm")
    start.day(days.indexOf(day))    //look this week
    let end = moment(start)
    end.add(duration, 'm')
    // console.log(start.valueOf(), end.valueOf(), testTime.valueOf())
    if(testTime.isBetween(start, end)) {
        return true
    }

    start.day(days.indexOf(day)-7)  //look a week before
    end.subtract(1, 'w')
    if(testTime.isBetween(start,end)) {
        return true
    }
    
    start.day(days.indexOf(day)+14) //look a week after
    end.add(2, 'w')
    if(testTime.isBetween(start,end)) {
        return true
    }
    
    return false
}


function stationOn(stationIndex) {

    if(!stationStates[stationIndex]) {
        if( stationsOn >= maxStationsOn ) {
            console.log("Max of "+maxStationsOn+" stations allowed. Operation suspended!")
            return false
        }
            //set time between turning station on to avoid pulling to much power
        setTimeout( ()=>{
            console.log("Station "+(stationIndex+1)+" On")
            stationStates[stationIndex] = true
            workingSchedule['station'+(stationIndex+1)].on = true
            writeStation(stationIndex, 1)
	    saveScheduleFile()
        }, timeGapBetweenFirings*stationsOn++)
        return true
    }
}
function stationOff(stationIndex) {
    if(stationStates[stationIndex]) {
        console.log("Station "+(stationIndex+1)+" Off")
        stationStates[stationIndex] = false
        workingSchedule['station'+(stationIndex+1)].on = false
	writeStation(stationIndex, 0)        
	saveScheduleFile()
        stationsOn--
        return true
    }
}

function saveScheduleFile() {
    fs.writeFileSync('schedule.json', JSON.stringify(workingSchedule,null,4))
}

app.get('/schedule/station/:stationNumber', function(req, res) {
    let scheduleRaw = fs.readFileSync('schedule.json')
    let schedule = JSON.parse(scheduleRaw)
    workingSchedule = schedule
    res.json(schedule["station"+parseInt(req.params.stationNumber)])
})

app.post('/schedule/station/:stationNumber/day/:day', function(req, res) {
    let scheduleRaw = fs.readFileSync('schedule.json')
    let schedule = JSON.parse(scheduleRaw)
    let stationEvents = schedule["station"+req.params.stationNumber][req.params.day]
    let eventId = nextId(stationEvents, 0)

    stationEvents.push({id: eventId, startTime: req.body.startTime, duration: req.body.duration})

    schedule["station"+req.params.stationNumber][req.params.day]=stationEvents
    workingSchedule = schedule

    fs.writeFileSync('schedule.json', JSON.stringify(schedule,null,4))

    console.log({id: eventId, ...req.body}, "in", req.params)
    res.json({status: "success", id: eventId})
})
//Find next available id
function nextId(stationEvents, proposedId) {
    for(let i=0;i<stationEvents.length;i++) {
        if(stationEvents[i].id==proposedId)
            return nextId(stationEvents, proposedId+1)
    }
    return proposedId
}

app.delete('/schedule/station/:stationNumber/day/:day/event/:eventId', function(req, res) {
    let scheduleRaw = fs.readFileSync('schedule.json')
    let schedule = JSON.parse(scheduleRaw)
    let stationEvents = schedule["station"+req.params.stationNumber][req.params.day]
    stationEvents = stationEvents.filter((stationEvent)=>{
        return req.params.eventId != stationEvent.id
    })
    schedule["station"+req.params.stationNumber][req.params.day] = stationEvents

    workingSchedule = schedule
    fs.writeFileSync('schedule.json', JSON.stringify(schedule,null,4))
    res.json({status: "success"})
})

app.listen(port, () => {
    console.log("Listening at http://localhost:"+port)
})