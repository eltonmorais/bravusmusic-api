import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin'

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

    if (schema === "cifraPro" || schema === "mainSettings" || schema === "userRoles" || schema === "users") {
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

    if (schema === "cifraPro" || schema === "mainSettings" || schema === "userRoles" || schema === "users") {
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

    if (schema === "cifraPro" || schema === "mainSettings" || schema === "userRoles" || schema === "users") {
        if (schema === "users") {

            const request = require('request');
            // const express = require('express')
            // const app = express()
            // const port = 3001

            const requestOptions = (method) => {
                return {
                    method: method,
                    headers: {
                        "Api-Token": "ea09de296461ae5edf7f54e95a58a895c8ee46e8dca86b9061b990ebce5e0260b0d51731"
                    },
                    url: `https://bravusmusic.api-us1.com/api/3/`,
                    qs: { "field[fieldid]": "1", "field[val]": "cdd" }
                };
            }

            const options = requestOptions('GET');
            options.url = `${options.url}fieldvalues`;

            console.log(options.url)

            return new Promise(async function (resolve, reject) {
                // Do async job
                console.log("promise")
                console.log(resolve)
                const result = await request.get(options, function (err, resp, body) {
                    console.log("resp")
                    console.log(resp)
                    console.log(body)
                    console.log(err)
                    if (err) {
                        console.log(err)
                        reject(err);
                    } else {
                        console.log(body)
                        resolve(body);
                    }
                })

                console.log("result")
                console.log(result)
                console.log("result.body")
                console.log(result.body)
            });


            // const activeCampaign = require('activecampaign')

            // const ac = new activeCampaign("https://bravusmusic.api-us1.com", "ea09de296461ae5edf7f54e95a58a895c8ee46e8dca86b9061b990ebce5e0260b0d51731")

            // console.log("216")

            // ac.version(3)

            // console.log("220")

            // ac.credentials_test().then(function (result) {
            //     // successful request
            //     console.log("224")
            //     console.log("result")
            //     console.log(result)
            //     if (result.success) {
            //         // VALID ACCOUNT
            //         console.log("valid Account")
            //     } else {
            //         // INVALID ACCOUNT
            //         console.log("INvalid Account")
            //     }
            // }, function (result) {
            //     // request error
            // });

            // console.log("238")

            // const fieldValues = ac.api("fieldvalues", { "filters[fieldid]": "1", "filters[val]": "cdd" })

            // return fieldValues.then(function (result) {
            //     console.log("success")
            //     console.log(result)
            // }, function (result) {
            //     console.log("error")
            //     console.log(result)
            // })
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