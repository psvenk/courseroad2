import axios from 'axios';
import moment from 'moment';
import Vue from 'vue';
import Vuex from 'vuex';

Vue.use(Vuex);

const DATE_FORMAT = 'YYYY-MM-DDTHH:mm:ss.SSS000Z';

const getDefaultState = () => {
  return {
    versionNumber: '1.0.0', // change when making backwards-incompatible changes
    currentSemester: 1,
    activeRoad: '$defaultroad$',
    addingFromCard: false,
    classInfoStack: [],
    cookiesAllowed: undefined,
    fullSubjectsInfoLoaded: false,
    genericCourses: [],
    genericIndex: {},
    itemAdding: undefined,
    loggedIn: false,
    hideIAP: localStorage.hideIAP === 'true',
    roads: {
      $defaultroad$: {
        downloaded: moment().format(DATE_FORMAT),
        changed: moment().format(DATE_FORMAT),
        name: 'My First Road',
        agent: '',
        contents: {
          coursesOfStudy: ['girs'],
          selectedSubjects: Array.from(Array(16), () => []),
          progressOverrides: {},
          progressAssertions: {}
        }
      }
    },
    subjectsIndex: {},
    subjectsInfo: [],
    ignoreRoadChanges: false,
    // When changes are made to roads, different levels of fulfillment need to be update in the audit
    // all: update audit for all majors (for changes like adding a class)
    // {specific major}: update audit for a specific major (for changes like adding a major)
    // none: no update to audit is needed (for changes like road name)
    fulfillmentNeeded: 'all',
    // list of road IDs that have not been retrieved from the server yet
    unretrieved: [],
    loadSubjectsPromise: undefined,
    loadedSubjects: false,
    roadsToMigrate: []
  };
};

const store = new Vuex.Store({
  strict: process.env.NODE_ENV !== 'production',
  state: getDefaultState(),
  getters: {
    userYear (state) {
      return Math.floor((state.currentSemester - 1) / 3);
    },
    hideIAP: state => {
      return state.hideIAP;
    }
  },
  mutations: {
    resetState (state) {
      Object.assign(state, getDefaultState());
    },
    addClass (state, newClass) {
      state.roads[state.activeRoad].contents.selectedSubjects[newClass.semester].push(newClass);
      state.roads[state.activeRoad].changed = moment().format(DATE_FORMAT);
    },
    addFromCard (state, classItem) {
      state.addingFromCard = true;
      state.itemAdding = classItem;
    },
    addReq (state, event) {
      state.roads[state.activeRoad].contents.coursesOfStudy.push(event);
      state.roads[state.activeRoad].changed = moment().format(DATE_FORMAT);
      state.fulfillmentNeeded = event;
    },
    migrateOldSubjects (state, roadID) {
      for (var i = 0; i < 16; i++) {
        for (var j = 0; j < state.roads[roadID].contents.selectedSubjects[i].length; j++) {
          const subject = state.roads[roadID].contents.selectedSubjects[i][j];

          const subjectIndex = state.subjectsIndex[subject.subject_id];
          const genericIndex = state.genericIndex[subject.subject_id];

          const notInCatalog = subjectIndex === undefined && genericIndex === undefined;
          const isHistorical = subjectIndex !== undefined && state.subjectsInfo[subjectIndex].is_historical;

          if (notInCatalog || isHistorical) {
            // Look for subject with old ID
            const oldSubjects = state.subjectsInfo.filter((subj) => {
              return subj.old_id === subject.subject_id;
            });

            if (oldSubjects.length > 0) {
              const oldSubject = oldSubjects[0];
              subject.subject_id = oldSubject.subject_id;
              subject.title = oldSubject.title;
              subject.units = oldSubject.total_units;
            }
          }
        }
      }
    },
    allowCookies (state) {
      state.cookiesAllowed = true;
    },
    cancelAddFromCard (state) {
      state.addingFromCard = false;
      state.itemAdding = undefined;
    },
    clearClassInfoStack (state) {
      state.classInfoStack = [];
    },
    disallowCookies (state) {
      state.cookiesAllowed = false;
    },
    deleteRoad (state, id) {
      state.ignoreRoadChanges = true;
      Vue.delete(state.roads, id);
    },
    dragStartClass (state, event) {
      let classInfo = event.classInfo;
      if (classInfo === undefined) {
        if (event.basicClass.subject_id in state.subjectsIndex) {
          classInfo = state.subjectsInfo[state.subjectsIndex[event.basicClass.subject_id]];
        } else if (event.basicClass.subject_id in state.genericIndex) {
          classInfo = state.genericCourses[state.genericIndex[event.basicClass.subject_id]];
        }
      }
      state.itemAdding = classInfo;
      state.addingFromCard = false;
    },
    moveClass (state, { currentClass, classIndex, semester }) {
      state.roads[state.activeRoad].contents.selectedSubjects[currentClass.semester].splice(classIndex, 1);
      currentClass.semester = semester;
      state.roads[state.activeRoad].contents.selectedSubjects[semester].push(currentClass);
      state.roads[state.activeRoad].changed = moment().format(DATE_FORMAT);
    },
    overrideWarnings (state, payload) {
      const classIndex = state.roads[state.activeRoad].contents.selectedSubjects[payload.classInfo.semester].indexOf(payload.classInfo);
      state.roads[state.activeRoad].contents.selectedSubjects[payload.classInfo.semester][classIndex].overrideWarnings = payload.override;
    },
    setPASubstitutions (state, { uniqueKey, newReqs }) {
      Vue.set(state.roads[state.activeRoad].contents.progressAssertions, uniqueKey, { substitutions: newReqs });
      Vue.set(state.roads[state.activeRoad], 'changed', moment().format(DATE_FORMAT));
    },
    setPAIgnore (state, { uniqueKey, isIgnored }) {
      const progressAssertion = state.roads[state.activeRoad].contents.progressAssertions[uniqueKey];
      if (isIgnored === true) {
        if (progressAssertion === undefined) {
          Vue.set(state.roads[state.activeRoad].contents.progressAssertions, uniqueKey, { ignore: isIgnored });
        } else {
          progressAssertion.ignore = isIgnored;
        }
      } else {
        if (progressAssertion.substitutions === undefined) {
          this.commit('removeProgressAssertion', uniqueKey);
        } else {
          Vue.delete(progressAssertion, 'ignore');
        }
      }
      Vue.set(state.roads[state.activeRoad], 'changed', moment().format(DATE_FORMAT));
    },
    setUnretrieved (state, roadIDs) {
      state.unretrieved = roadIDs;
    },
    setRetrieved (state, roadID) {
      // Remove from unretrieved list when a road is retrieved
      const roadIDIndex = state.unretrieved.indexOf(roadID);
      if (roadIDIndex >= 0) {
        state.unretrieved.splice(roadIDIndex, 1);
      }
    },
    parseGenericCourses (state) {
      const girAttributes = {
        PHY1: ['Physics 1 GIR', 'p1'],
        PHY2: ['Physics 2 GIR', 'p2'],
        CHEM: ['Chemistry GIR', 'c'],
        BIOL: ['Biology GIR', 'b'],
        CAL1: ['Calculus I GIR', 'm1'],
        CAL2: ['Calculus II GIR', 'm2'],
        LAB: ['Lab GIR', 'l1'],
        REST: ['REST GIR', 'r']
      };
      // the titles of the hass and ci attributes are currently not used in the description on fireroad
      // I think they might be nice to display with the description, but as of now they are unused
      const hassAttributes = {
        'HASS-A': ['HASS Arts', 'ha'],
        'HASS-S': ['HASS Social Sciences', 'hs'],
        'HASS-H': ['HASS Humanities', 'hh'],
        'HASS-E': ['HASS Elective', 'ht']
      };
      const ciAttributes = {
        'CI-H': ['Communication Intensive', 'hc'],
        'CI-HW': ['Communication Intensive with Writing', 'hw']
      };
      const genericCourses = [];
      const baseGeneric = {
        description: 'Use this generic subject to indicate that you are fulfilling a requirement, but do not yet have a specific subject selected.',
        total_units: 12
      };
      const baseurl = 'http://student.mit.edu/catalog/search.cgi?search=&style=verbatim&when=*&termleng=4&days_offered=*&start_time=*&duration=*&total_units=*';
      for (const gir in girAttributes) {
        const offeredGir = getMatchingAttributes(gir, undefined, undefined);
        genericCourses.push(Object.assign({}, baseGeneric, offeredGir, {
          gir_attribute: gir,
          title: 'Generic ' + girAttributes[gir][0],
          subject_id: gir,
          url: baseurl + '&cred=' + girAttributes[gir][1] + '&commun_int=*'
        }));
      }
      for (const hass in hassAttributes) {
        const offeredHass = getMatchingAttributes(undefined, hass, undefined);
        genericCourses.push(Object.assign({}, baseGeneric, offeredHass, {
          hass_attribute: hass,
          title: 'Generic ' + hass,
          subject_id: hass,
          url: baseurl + '&cred=' + hassAttributes[hass][1] + '&commun_int=*'
        }));
        const offeredHassCI = getMatchingAttributes(undefined, hass, 'CI-H');
        genericCourses.push(Object.assign({}, baseGeneric, offeredHassCI, {
          hass_attribute: hass,
          communication_requirement: 'CI-H',
          title: 'Generic CI-H ' + hass,
          subject_id: 'CI-H ' + hass,
          url: baseurl + '&cred=' + hassAttributes[hass][1] + '&commun_int=' + ciAttributes['CI-H'][1]
        }));
      }
      for (const ci in ciAttributes) {
        const offeredCI = getMatchingAttributes(undefined, undefined, ci);
        genericCourses.push(Object.assign({}, baseGeneric, offeredCI, {
          communication_requirement: ci,
          title: 'Generic ' + ci,
          hass_attribute: 'HASS',
          subject_id: ci,
          url: baseurl + '&cred=*&commun_int=' + ciAttributes[ci][1]
        }));
      }
      state.genericCourses = genericCourses;
    },
    parseGenericIndex (state) {
      state.genericIndex = state.genericCourses.reduce(function (obj, item, index) {
        obj[item.subject_id] = index;
        return obj;
      }, {});
    },
    parseSubjectsIndex (state) {
      state.subjectsIndex = state.subjectsInfo.reduce(function (obj, item, index) {
        obj[item.subject_id] = index;
        return obj;
      }, {});
    },
    popClassStack (state) {
      state.classInfoStack.pop();
    },
    pushClassStack (state, id) {
      if (id in state.subjectsIndex || id in state.genericIndex) {
        if (state.classInfoStack.length === 0 || id !== state.classInfoStack[state.classInfoStack.length - 1]) { // we don't want to push to the stack if we click the same class over and over again
          state.classInfoStack.push(id);
        }
      }
    },
    removeClass (state, { classInfo, classIndex }) {
      state.roads[state.activeRoad].contents.selectedSubjects[classInfo.semester].splice(classIndex, 1);
      state.roads[state.activeRoad].changed = moment().format(DATE_FORMAT);
    },
    removeReq (state, event) {
      const reqIndex = state.roads[state.activeRoad].contents.coursesOfStudy.indexOf(event);
      if (reqIndex === -1) {
        console.log('Attempted to remove a requirement not in the requirements list.');
      } else {
        state.roads[state.activeRoad].contents.coursesOfStudy.splice(reqIndex, 1);
        state.roads[state.activeRoad].changed = moment().format(DATE_FORMAT);
        state.fulfillmentNeeded = 'none';
      }
    },
    removeProgressAssertion (state, uniqueKey) {
      Vue.delete(state.roads[state.activeRoad].contents.progressAssertions, uniqueKey);
      Vue.set(state.roads[state.activeRoad], 'changed', moment().format(DATE_FORMAT));
    },
    resetID (state, { oldid, newid }) {
      newid = newid.toString();
      Vue.set(state.roads, newid, state.roads[oldid]);
      if (state.activeRoad === oldid) {
        state.activeRoad = newid;
      }
      Vue.delete(state.roads, oldid);
      state.ignoreRoadChanges = true;
      state.fulfillmentNeeded = 'none';
      const migrationIndex = state.roadsToMigrate.indexOf(oldid);
      if (migrationIndex >= 0) {
        state.roadsToMigrate.splice(migrationIndex, 1, newid);
      }
    },
    setActiveRoad (state, activeRoad) {
      state.activeRoad = activeRoad;
    },
    setFullSubjectsInfoLoaded (state, isFull) {
      state.fullSubjectsInfoLoaded = isFull;
    },
    setLoggedIn (state, newLoggedIn) {
      state.loggedIn = newLoggedIn;
    },
    setHideIAP: (state, value) => {
      state.hideIAP = value;
      localStorage.hideIAP = value;
    },
    setRoadProp (state, { id, prop, value, ignoreSet }) {
      if (ignoreSet) {
        state.ignoreRoadChanges = true;
      }
      if (prop !== 'contents') {
        state.fulfillmentNeeded = 'none';
      }
      Vue.set(state.roads[id], prop, value);
    },
    setRoad (state, { id, road, ignoreSet }) {
      if (ignoreSet) {
        state.ignoreRoadChanges = true;
      }
      if (state.activeRoad !== id) {
        state.fulfillmentNeeded = 'none';
      }
      Vue.set(state.roads, id, road);
    },
    setRoads (state, roads) {
      state.roads = roads;
    },
    setRoadName (state, { id, name }) {
      state.roads[id].name = name;
      state.roads[id].changed = moment().format(DATE_FORMAT);
    },
    setSubjectsInfo (state, data) {
      state.subjectsInfo = data;
    },
    setCurrentSemester (state, sem) {
      state.currentSemester = Math.max(1, sem);
    },
    updateProgress (state, progress) {
      Vue.set(state.roads[state.activeRoad].contents.progressOverrides, progress.listID, progress.progress);
      state.roads[state.activeRoad].changed = moment().format(DATE_FORMAT);
    },
    setFromLocalStorage (state, localStore) {
      store.replaceState(localStore);
    },
    updateRoad (state, id, road) {
      Object.assign(state.roads[id], road);
    },
    watchRoadChanges (state) {
      state.ignoreRoadChanges = false;
    },
    // Reset fulfillment needed to default of all
    resetFulfillmentNeeded (state) {
      state.fulfillmentNeeded = 'all';
    },
    setLoadSubjectsPromise (state, promise) {
      state.loadSubjectsPromise = promise;
    },
    setSubjectsLoaded (state) {
      state.subjectsLoaded = true;
    },
    queueRoadMigration (state, roadID) {
      state.roadsToMigrate.push(roadID);
    },
    clearMigrationQueue (state) {
      state.roadsToMigrate = [];
    }
  },
  actions: {
    async loadAllSubjects ({ commit, state }) {
      const promise = axios.get(process.env.VUE_APP_FIREROAD_URL + '/courses/all?full=true');
      commit('setLoadSubjectsPromise', promise);
      const response = await promise;
      commit('setSubjectsLoaded');
      commit('setSubjectsInfo', response.data);
      commit('setFullSubjectsInfoLoaded', true);
      commit('parseGenericCourses');
      commit('parseGenericIndex');
      commit('parseSubjectsIndex');
      for (const roadID of state.roadsToMigrate) {
        commit('migrateOldSubjects', roadID);
      }
      commit('clearMigrationQueue');
    },
    addAtPlaceholder ({ commit, state }, index) {
      const newClass = {
        overrideWarnings: false,
        semester: index,
        title: state.itemAdding.title,
        subject_id: state.itemAdding.subject_id,
        units: state.itemAdding.total_units
      };
      commit('addClass', newClass);
      commit('cancelAddFromCard');
    },
    async waitLoadSubjects ({ dispatch, state }) {
      if (state.loadSubjectsPromise !== undefined) {
        return state.loadSubjectsPromise;
      } else {
        return dispatch('loadAllSubjects');
      }
    },
    waitAndMigrateOldSubjects ({ dispatch, commit, state }, roadID) {
      if (state.subjectsLoaded) {
        commit('migrateOldSubjects', roadID);
      } else {
        commit('queueRoadMigration', roadID);
        dispatch('waitLoadSubjects');
      }
    }
  }
});

function getMatchingAttributes (gir, hass, ci) {
  const matchingClasses = store.state.subjectsInfo.filter(function (subject) {
    if (gir !== undefined && subject.gir_attribute !== gir) {
      return false;
    }
    if (hass !== undefined && subject.hass_attribute !== hass) {
      return false;
    }
    return !(ci !== undefined && subject.communication_requirement !== ci);
  });

  const totalObject = matchingClasses.reduce(function (accumObject, nextClass) {
    return {
      offered_spring: accumObject.offered_spring || nextClass.offered_spring,
      offered_summer: accumObject.offered_summer || nextClass.offered_summer,
      offered_IAP: accumObject.offered_IAP || nextClass.offered_IAP,
      offered_fall: accumObject.offered_fall || nextClass.offered_fall,
      in_class_hours: accumObject.in_class_hours + (nextClass.in_class_hours !== undefined ? nextClass.in_class_hours : 0),
      out_of_class_hours: accumObject.out_of_class_hours + (nextClass.out_of_class_hours !== undefined ? nextClass.out_of_class_hours : 0)
    };
  }, { offered_spring: false, offered_summer: false, offered_IAP: false, offered_fall: false, in_class_hours: 0, out_of_class_hours: 0 });
  totalObject.in_class_hours /= matchingClasses.length;
  totalObject.out_of_class_hours /= matchingClasses.length;
  return totalObject;
}

export default store;
