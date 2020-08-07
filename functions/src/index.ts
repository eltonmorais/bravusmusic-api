import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin'
import gcm = require("node-gcm")

const _verifyToken = "98765432e1";

export const createUserEmailPassword = functions.https.onRequest((req, res) => {

    admin.initializeApp()

    const token = req.body.token

    if (token !== _verifyToken) {
        res.status(403)
        res.send({ "status": 403, "message": "Token incorreto" })
        return
    }

    const email = req.body.email
    const password = req.body.password
    const displayName = req.body.displayName ?? ""
    const role = req.body.role ?? "aluno"
    const nowIsoString = new Date(Date.now()).toISOString()
    let schemaRef
    let roleRef
    let userData

    if (email === null || email === "") {
        res.status(403)
        res.send({ "status": 403, "message": "Campo 'email' é obrigatório" })
    }

    if (password === null || password === "") {
        res.status(403)
        res.send({ "status": 403, "message": "Campo 'password' é obrigatório" })
    }

    admin.auth().createUser({
        email: email,
        emailVerified: false,
        password: password,
        displayName: displayName,
        disabled: false,
    }).then(value => {
        admin.firestore().collection("fl_schemas").where("id", "==", "users").get().then(
            allDocuments => {
                if (allDocuments.docs.length < 1) {
                    res.status(404)
                    res.send("Can't find Schema 'users'")
                    return
                }

                schemaRef = allDocuments.docs[0].ref

                const docId = admin.firestore().collection('fl_content').doc().id

                admin.firestore().collection("fl_content")
                    .where("_fl_meta_.schema", "==", "userRoles").where("slug", "==", role).get()
                    .then(allRoles => {
                        if (allRoles.docs.length < 1) {
                            res.status(404)
                            res.send("Can't find role " + role)
                            return
                        }

                        roleRef = allRoles.docs[0].ref

                        userData = {
                            "_fl_meta_": {
                                "createdBy": "6oBrXCbYQdWnKE8MdS3mzUx1Dhv2",
                                "createdDate": nowIsoString,
                                "docId": docId,
                                "env": "production",
                                "fl_id": docId,
                                "lastModifiedBy": "nodeAPI",
                                "lastModifiedDate": nowIsoString,
                                "locale": "en-US",
                                "schema": "users",
                                "schemaRef": schemaRef,
                                "schemaType": "collection",
                            },
                            "birthdayDate": "",
                            "displayName": displayName,
                            "email": email,
                            "id": docId,
                            "order": 0,
                            "parentId": 0,
                            "phone": "",
                            "providerDisplayName": displayName,
                            "providerEmail": email,
                            "providerSource": "email",
                            "role": roleRef,
                            "uid": value.uid,
                        }

                        admin.firestore().collection('fl_content').doc(docId).set(userData).then(valueDoc => {
                            res.status(200)
                            res.send({ "status": 200, "message": valueDoc.writeTime })
                        }).catch(err => {
                            admin.firestore().collection('fl_content').doc(docId).get()
                                .then(finalValue => {
                                    res.status(200)
                                    res.send({ "status": 200, "uid": finalValue.id })
                                }).catch(error => {
                                    res.status(400)
                                    res.send("error: " + error)
                                })
                        })

                    }).catch(err => {
                        res.status(400)
                        res.send("error: " + err)
                    })
            }
        ).catch(err => {
            res.status(400)
            res.send("error: " + err)
        })
    }).catch(err => {
        res.status(400)
        res.send("error: " + err)
    })
})

export const onCourseDelete = functions.firestore.document('fl_content/{documentId}').onDelete(snapshot => {

    _initializeFirestore()

    const createdData = snapshot.data()
    const docId = snapshot.id

    const schema = _getSchema(createdData)

    if (schema === "pushMessage" || schema === "cifraPro" || schema === "mainSettings" || schema === "userRoles" || schema === "users") {
        return null
    }

    if (schema !== "curso") {
        const pathSegments = createdData['parent_course']['_path']['segments']
        const courseId = pathSegments[1]

        return _deleteItem(docId, courseId)
    } else {
        return _deleteCourse(docId)
    }
})

export const onCourseCreate = functions.firestore.document('fl_content/{documentId}').onCreate(snapshot => {

    _initializeFirestore()

    const createdData = snapshot.data()
    const docId = snapshot.id

    const schema = _getSchema(createdData)

    if (schema === "pushMessage" || schema === "cifraPro" || schema === "mainSettings" || schema === "userRoles" || schema === "users") {
        return null
    }

    if (schema === "curso") {
        if (snapshot.exists) {
            return _setCourse(createdData, docId)
        } else {
            return _deleteCourse(docId)
        }
    } else {
        const pathSegments = createdData['parent_course']['_path']['segments']
        const courseId = pathSegments[1]

        if (snapshot.exists) {
            switch (schema) {
                case "modulo":
                    return _setModuleItem(createdData, docId, courseId, courseId)
                case "lesson":
                    const pathModuleSegments = createdData['parent_module']['_path']['segments']
                    const moduleId = pathModuleSegments[1]
                    return _setLessonItem(createdData, docId, courseId, moduleId)
                case "content":
                    const pathVideoSegments = createdData['parent_video']['_path']['segments']
                    const videoId = pathVideoSegments[1]
                    return _setContent(createdData, docId, courseId, videoId)
                case "video":
                    const pathLessonSegments = createdData['parent_lesson']['_path']['segments']
                    const lessonId = pathLessonSegments[1]
                    return _setVideo(createdData, docId, courseId, lessonId)
            }

        }
    }

    return null
})

export const onCourseChange = functions.firestore.document('fl_content/{documentId}').onUpdate(snapshot => {

    _initializeFirestore()

    let createdData = snapshot.after.data()
    let docId = snapshot.after.id
    if (createdData === undefined) {
        createdData = snapshot.before
        docId = snapshot.before.id
    }
    const schema = _getSchema(createdData)

    if (schema === "pushMessage" || schema === "cifraPro" || schema === "mainSettings" || schema === "userRoles" || schema === "users") {
        if (schema === "users") {
            return _proccessUserUpdate(snapshot.before.data(), snapshot.after.data())
        }
        return null
    }


    if (schema === "curso") {
        if (snapshot.after.exists) {
            return _setCourse(createdData, docId)
        } else {
            return _deleteCourse(docId)
        }
    } else {
        const pathSegments = createdData['parent_course']['_path']['segments']
        const courseId = pathSegments[1]

        if (snapshot.after.exists) {
            switch (schema) {
                case "modulo":
                    return _setModuleItem(createdData, docId, courseId, courseId)
                case "lesson":
                    const pathModuleSegments = createdData['parent_module']['_path']['segments']
                    const moduleId = pathModuleSegments[1]
                    return _setLessonItem(createdData, docId, courseId, moduleId)
                case "content":
                    const pathVideoSegments = createdData['parent_video']['_path']['segments']
                    const videoId = pathVideoSegments[1]
                    return _setContent(createdData, docId, courseId, videoId)
                case "video":
                    const pathLessonSegments = createdData['parent_lesson']['_path']['segments']
                    const lessonId = pathLessonSegments[1]
                    return _setVideo(createdData, docId, courseId, lessonId)
            }

        } else {
            return _deleteItem(docId, courseId)
        }
    }

    return null
})

function _contactGetEmail(data: any) {
    let emailToActive = data['email']
    if (emailToActive === undefined || emailToActive === "") {
        emailToActive = data['providerEmail']
    }

    if (emailToActive === undefined || emailToActive === "") {
        emailToActive = data['uid'] + '@bravusmusic.com'
    }

    return emailToActive
}

function _contactGetName(data: any) {
    let displayName = data['displayName']
    if (displayName === undefined || displayName === "") {
        displayName = data['providerDisplayName']
    }

    if (displayName === undefined || displayName === "") {
        displayName = ""
    }

    return displayName
}

function _getActiveApiHeaders() {
    return {
        "Api-Token": "ea09de296461ae5edf7f54e95a58a895c8ee46e8dca86b9061b990ebce5e0260b0d51731",
        "Content-Type": "application/json"
    }
}

export const onLogCreate = functions.firestore.document('academy_log/{documentId}').onCreate(async snapshot => {
    const createdData = snapshot.data()

    let eventSlug
    let statusLabel
    let userData
    let uid

    try {
        statusLabel = createdData['labelStatus']
        eventSlug = createdData['eventSlug']
        uid = createdData['uid']
    } catch (error) {
        console.log("error populating data")
        console.log(error)
    }

    try {
        _initializeFirestore()
        const _document = await admin.firestore().collection("fl_content").where("uid", "==", uid).get()
        userData = _document.docs[0].data()
    } catch (error) {
        console.log("error fingind user")
        console.log(error)
    }

    await _acEventCreate(eventSlug)

    return _acEventTrack(eventSlug, _contactGetEmail(userData), statusLabel).then((res) => {
        console.log(res)
    }, (error) => {
        console.log(error)
    })
})

async function _acEventCreate(eventSlug: any) {
    _initializeFirestore()

    const _docs = await admin.firestore().collection("acEventsSync").where("name", "==", eventSlug).get()
    if (_docs.docs.length < 1) {
        await _acEventCreateRemote(eventSlug).then((res) => {
            console.log(res)
        })

        _initializeFirestore()

        admin.firestore().collection("acEventsSync").doc().set({
            "name": eventSlug,
        }).then((res) => console.log(res), (err) => console.log(err))
    }
}

async function _acEventCreateRemote(eventSlug: any) {
    const request = require('axios');

    const options = {
        headers: _getActiveApiHeaders(),
        data: {
            "eventTrackingEvent": {
                "name": eventSlug
            },

        },
        method: "POST",
        json: true,
        url: "https://bravusmusic.api-us1.com/api/3/eventTrackingEvents"
    }

    return request(options)
}

async function _acEventTrack(eventSlug: any, contactEmail: any, eventData?: any) {
    const request = require('axios');

    const _eventData = eventData ?? ""

    const options = {
        headers: _getActiveApiHeaders(),
        data: {
            "actid": "799714071",
            "key": "1afdbe13107fd141dabb94c90c0e6b85b5b5c6d7",
            "event": eventSlug,
            "eventdata": _eventData,
            "visit": {
                "email": contactEmail
            }

        },
        method: "POST",
        json: true,
        url: "https://trackcmp.net/event"
    }

    console.log(options)

    return request(options)
}

async function _updateActiveCampaignFCM(contactID: any, fcmToken: any) {
    const request = require('axios');

    const options = {
        headers: _getActiveApiHeaders(),
        data: {
            "fieldValue": {
                "contact": contactID,
                "field": "2",
                "value": encodeURI(fcmToken)
            }
        },
        method: "POST",
        json: true,
        url: "https://bravusmusic.api-us1.com/api/3/"
    }

    options.url = options.url + 'fieldValues'

    return request(options).then((res) => {
        console.log(res)
    }, (error) => {
        console.log(error)
    })
}

async function _activeContactCreate(email: any, firstName: any, lastName: any, phone: any, userDocId: any, fcmToken?: any, contactID?: any) {
    const request = require('axios');

    const options = {
        headers: _getActiveApiHeaders(),
        data: {
            "contact": {
                "email": email,
                "firstName": firstName,
                "lastName": lastName,
                "phone": phone
            }
        },
        method: "POST",
        json: true,
        url: "https://bravusmusic.api-us1.com/api/3/"
    }

    if (contactID !== undefined) {
        options.method = 'PUT'
        options.url = options.url + 'contacts/' + contactID
    } else {
        options.url = options.url + 'contact/sync'
    }

    return request(options).then((res) => {
        const _activeCampaignID = res.data['contact']['id']

        if (fcmToken !== undefined) {
            try {
                _updateActiveCampaignFCM(_activeCampaignID, fcmToken).then((resFcm) => {
                    console.log(resFcm)
                }, (err) => {
                    console.log(err)
                })
            } catch (error) {
                console.log(error)
            }
        }

        return admin.firestore().collection("fl_content").doc(userDocId).set({ 'activeCampaignID': _activeCampaignID }, { merge: true })

    }, (error) => {
        console.log(error)
    })
}

export const sendPushNotification = functions.https.onRequest(async (req, res) => {

    const data = req.body
    const messageId = req.query.messageId as string
    let _fcmToken
    let _body
    let _title
    let _finalBody
    let _finalTitle
    let _document

    try {
        _fcmToken = decodeURI(data['contact']['fields']['firebasemessagingtoken'])
    } catch (error) {
        res.status(403).send("dont have token")
        return
    }

    try {
        //get message from db
        _initializeFirestore()
        _document = await admin.firestore().collection('fl_content').doc(messageId).get()
    } catch (error) {
        console.log(error)
        console.log(messageId)
        res.status(404).send("dont found message")
        return
    }

    try {
        const _data = _document.data()
        _body = _data['body']
        _title = _data['title']
    } catch (error) {
        console.log(error)
        console.log(_body)
        res.status(404).send("undefined data")
        return

    }

    try {
        //personalize message
        _finalBody = _body
        _finalTitle = _title
        let _stringBody = _finalBody as string
        let _stringTitle = _finalTitle as string
        Object.keys(data['contact']['fields']).forEach(element => {
            _stringBody = _stringBody.replace("%" + element + "%", data['contact']['fields'][element] as string)
            _stringTitle = _stringTitle.replace("%" + element + "%", data['contact']['fields'][element] as string)
        });
        _stringBody = _stringBody.replace("%email%", data['contact']['email'] as string)
        _stringTitle = _stringTitle.replace("%email%", data['contact']['email'] as string)
        _stringBody = _stringBody.replace("%first_name%", data['contact']['first_name'] as string)
        _stringTitle = _stringTitle.replace("%first_name%", data['contact']['first_name'] as string)
        _stringBody = _stringBody.replace("%last_name%", data['contact']['last_name'] as string)
        _stringTitle = _stringTitle.replace("%last_name%", data['contact']['last_name'] as string)
        _stringBody = _stringBody.replace("%phone%", data['contact']['phone'] as string)
        _stringTitle = _stringTitle.replace("%phone%", data['contact']['phone'] as string)

        _finalBody = _stringBody
        _finalTitle = _stringTitle
    } catch (error) {
        res.status(400).send("error building message")
        return
    }

    try {
        const sender = new gcm.Sender("AAAAUb2zJmI:APA91bGPjfUSvZHDQIFp-u7_Kdyqxy97RFECy6U81FEwGqxlxjfa5xZqt1aIE1Vl0L1m-wKT6NzZTkNEofmZu6D0BzLss4sy6lbHqsvbvZ-bTKMHm6dJ9jXGlk-PO5pRt7o82rfMTLsX")

        const message = new gcm.Message({
            notification: {
                title: _finalTitle,
                icon: "transparent",
                body: _finalBody
            },
        });

        sender.sendNoRetry(message, [_fcmToken], (err, response) => {
            if (err) {
                console.error(err)
                res.status(400).send("error sending message")
                return
            }
            else {
                const _failure = response['failure'] as number
                if (_failure > 0) {
                    _acEventTrack("APP-Student", data['contact']['email'], "Uninstall").then((result) => console.log(result), (error) => console.log(error))
                }
            }

        });
    } catch (error) {
        console.log(error)
        res.status(400).send("error building message")
        return
    }

    res.status(200).send("OK")
})

async function _proccessUserUpdate(dataBefore: any, dataAfter: any) {

    try {

        const emailToActive = _contactGetEmail(dataAfter)
        const displayNameToActive = _contactGetName(dataAfter)
        const phoneActive = dataAfter['phone']
        const _nameSplited = displayNameToActive.split(" ", 2)

        const _firstName = _nameSplited[0] ?? ""
        const _lastName = _nameSplited[1] ?? ""

        let _fcmToken

        if (dataBefore['fcmToken'] !== dataAfter['fcmToken']) {
            _fcmToken = dataAfter['fcmToken']
        }

        return _activeContactCreate(emailToActive, _firstName, _lastName, phoneActive, dataAfter['id'], _fcmToken, dataAfter['activeCampaignID'])
    } catch (error) {
        console.log(error)
    }

    return null
}

function _deleteItem(docId: any, courseId: any) {
    const dataToSave = {
        "contents": admin.firestore.FieldValue.arrayRemove(docId)
    }
    dataToSave[docId] = {}
    return admin.firestore().collection("courses").doc("course_" + courseId).set(dataToSave, { merge: true })
}

function _deleteCourse(courseId: any) {
    return admin.firestore().collection("courses").doc("course_" + courseId).delete()
}

function _setContent(data: any, docId: any, courseId: any, parentVideoId: any) {

    const dataToSave = {}
    dataToSave['contents'] = {}
    dataToSave['contents'][docId] = {
        "name": data['name'],
        "order": data['order'],
        "description": data['description'],
        "urlShow": data['urlShow'],
        "parentId": parentVideoId,
        "fileName": data['fileName'],
        "urlDownload": data['urlDownload'],
        "contentType": data['contentType'],
        "id": docId,
        "type": "AcademyElementType.Content",
        "isActive": data['isActive'],
    }

    return admin.firestore().collection("courses").doc("course_" + courseId).set(dataToSave, { merge: true })
}

function _setVideo(data: any, docId: any, courseId: any, parentLessonId: any) {

    const dataToSave = {}
    dataToSave['contents'] = {}
    dataToSave['contents'][docId] = {
        "name": data['name'],
        "order": data['order'],
        "thumb": data['thumb'],
        "parentId": parentLessonId,
        "urlFile": data['urlFile'],
        "description": data['description'],
        "id": docId,
        "type": "AcademyElementType.Video",
        "isActive": data['isActive'],
    }

    return admin.firestore().collection("courses").doc("course_" + courseId).set(dataToSave, { merge: true })
}

function _setLessonItem(data: any, docId: any, courseId: any, parentId: any) {

    const dataToSave = {}
    dataToSave['contents'] = {}
    dataToSave['contents'][docId] = {
        "name": data['name'],
        "order": data['order'],
        "parentId": parentId,
        "description": data['description'],
        "id": docId,
        "type": "AcademyElementType.Lesson",
        "isActive": data['isActive'],
    }

    return admin.firestore().collection("courses").doc("course_" + courseId).set(dataToSave, { merge: true })
}

function _setModuleItem(data: any, docId: any, courseId: any, parentId: any) {

    const dataToSave = {}
    dataToSave['contents'] = {}
    dataToSave['contents'][docId] = {
        "name": data['name'],
        "order": data['order'],
        "parentId": parentId,
        "description": data['description'],
        "id": docId,
        "type": "AcademyElementType.Module",
        "isActive": data['isActive'],
    }

    return admin.firestore().collection("courses").doc("course_" + courseId).set(dataToSave, { merge: true })
}

function _setCourse(data: any, docId: any) {

    const dataToSave = {}

    dataToSave['courseId'] = docId
    dataToSave['contents'] = {}
    dataToSave['contents'][docId] = {
        "name": data['name'],
        "id": docId,
        "isActive": data['isActive'],
        "gradient": data['gradient'],
        "icon": data['icon'],
        "order": data['order'],
        "type": "AcademyElementType.Course",
        "thumb": data['thumb'],
    }

    return admin.firestore().collection("courses").doc("course_" + docId).set(dataToSave, { merge: true })

}

function _initializeFirestore() {
    try {
        admin.initializeApp({})
        return true
    } catch (err) {
        return false
    }
}

function _getSchema(data: any) {

    if (data === undefined) {
        return null;
    }

    if (data['_fl_meta_'] === undefined) {
        return null;
    }

    if (data['_fl_meta_']['schema'] === undefined) {
        return null;
    }

    return data['_fl_meta_']['schema']
}