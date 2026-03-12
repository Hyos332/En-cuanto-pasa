const DEFAULT_SEMANAL_TARGETS = [
    { name: 'Diego Moys', weeklyTargetHours: 30 },
    { name: 'Bryan Baquedano', weeklyTargetHours: 25 },
    { name: 'Carlos Alvarado', weeklyTargetHours: 20 },
    { name: 'Diego Jimenez', weeklyTargetHours: 25 },
    { name: 'Angel Romero', weeklyTargetHours: 25 },
    { name: 'Marco Figueroa', weeklyTargetHours: 20 },
    { name: 'Luis Felipe Hoyos', weeklyTargetHours: 20 },
    { name: 'Kevin Ponce', weeklyTargetHours: 20 },
    { name: 'Katerine Rafael', weeklyTargetHours: 20 }
];

function normalizeIdentity(value) {
    return (value || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function parseConfiguredTargets(rawValue) {
    if (!rawValue || typeof rawValue !== 'string') {
        return [];
    }

    return rawValue
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .map(item => {
            const [namePart, hoursPart] = item.split(/[=:]/).map(part => part && part.trim());
            const hours = Number(hoursPart);
            if (!namePart || !Number.isFinite(hours)) {
                return null;
            }

            return {
                name: namePart,
                weeklyTargetHours: hours
            };
        })
        .filter(Boolean);
}

function getSemanalTargets() {
    const configured = parseConfiguredTargets(process.env.SEMANAL_WEEKLY_TARGETS);
    const source = configured.length > 0 ? configured : DEFAULT_SEMANAL_TARGETS;

    return source.map(target => ({
        ...target,
        personKey: normalizeIdentity(target.name),
        targetMinutes: Math.round(target.weeklyTargetHours * 60)
    }));
}

function parseHoursToMinutes(rawValue) {
    if (typeof rawValue !== 'string') {
        return null;
    }

    const value = rawValue.trim();
    if (!value) {
        return null;
    }

    const matchClock = value.match(/^([+-])?(\d{1,4}):([0-5]\d)$/);
    if (matchClock) {
        const sign = matchClock[1] === '-' ? -1 : 1;
        const hours = Number(matchClock[2]);
        const minutes = Number(matchClock[3]);
        return sign * ((hours * 60) + minutes);
    }

    const matchHuman = value.match(/^([+-])?\s*(\d+)\s*h(?:\s*(\d+)\s*m)?$/i);
    if (matchHuman) {
        const sign = matchHuman[1] === '-' ? -1 : 1;
        const hours = Number(matchHuman[2]);
        const minutes = Number(matchHuman[3] || 0);
        return sign * ((hours * 60) + minutes);
    }

    return null;
}

function formatMinutesClock(minutes, options = {}) {
    if (!Number.isFinite(minutes)) {
        return 'N/D';
    }

    const showPlus = options.showPlus === true;
    const abs = Math.abs(minutes);
    const hours = Math.floor(abs / 60);
    const mins = abs % 60;
    const sign = minutes < 0 ? '-' : (showPlus && minutes > 0 ? '+' : '');

    return `${sign}${hours}:${String(mins).padStart(2, '0')}`;
}

function formatWeekLabelFromIso(isoDate) {
    if (typeof isoDate !== 'string') {
        return isoDate;
    }

    const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        return isoDate;
    }

    return `${match[3]}/${match[2]}`;
}

function buildSemanalMatrix(historyRows, targets, options = {}) {
    const extraWeeks = Array.isArray(options.extraWeeks) ? options.extraWeeks : [];

    const weeksSet = new Set(extraWeeks.filter(Boolean));
    const personMap = new Map();
    const targetMap = new Map();

    targets.forEach(target => {
        targetMap.set(target.personKey, target);
        personMap.set(target.personKey, {
            personKey: target.personKey,
            personName: target.name,
            targetMinutes: target.targetMinutes,
            weekly: {},
            totalDeltaMinutes: 0
        });
    });

    (historyRows || []).forEach(row => {
        if (!row || !row.person_key || !row.report_date_iso) {
            return;
        }

        weeksSet.add(row.report_date_iso);

        if (!personMap.has(row.person_key)) {
            personMap.set(row.person_key, {
                personKey: row.person_key,
                personName: row.person_name || row.person_key,
                targetMinutes: Number.isFinite(row.target_minutes) ? row.target_minutes : null,
                weekly: {},
                totalDeltaMinutes: 0
            });
        }

        const person = personMap.get(row.person_key);
        if (row.person_name) {
            person.personName = row.person_name;
        }
        if (!Number.isFinite(person.targetMinutes) && Number.isFinite(row.target_minutes)) {
            person.targetMinutes = row.target_minutes;
        }

        if (Number.isFinite(row.delta_minutes)) {
            person.weekly[row.report_date_iso] = row.delta_minutes;
        }
    });

    const weeks = Array.from(weeksSet).sort();
    const configuredOrder = targets.map(target => target.personKey);
    const extraPeople = Array.from(personMap.keys())
        .filter(key => !configuredOrder.includes(key))
        .sort((a, b) => (personMap.get(a).personName || '').localeCompare(personMap.get(b).personName || ''));

    const orderedPeopleKeys = [...configuredOrder, ...extraPeople];
    const people = orderedPeopleKeys.map(personKey => {
        const person = personMap.get(personKey);
        if (!person) {
            return null;
        }

        let totalDeltaMinutes = 0;
        weeks.forEach(week => {
            const value = person.weekly[week];
            if (Number.isFinite(value)) {
                totalDeltaMinutes += value;
            }
        });

        return {
            ...person,
            totalDeltaMinutes
        };
    }).filter(Boolean);

    return { weeks, people, targetMap };
}

module.exports = {
    getSemanalTargets,
    normalizeIdentity,
    parseHoursToMinutes,
    formatMinutesClock,
    formatWeekLabelFromIso,
    buildSemanalMatrix
};
