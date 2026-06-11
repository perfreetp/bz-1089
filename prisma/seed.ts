import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

type UfoCategory = 'DISC' | 'SPHERE' | 'TRIANGLE' | 'CYLINDER' | 'LIGHT' | 'ORB' | 'OTHER';
type CredibilityLevel = 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
type SightingStatus = 'PENDING' | 'VERIFIED' | 'DISPROVED' | 'MERGED' | 'INVESTIGATING';
type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
type NotificationType = 'NEW_SIGHTING' | 'REVIEW_REQUESTED' | 'REVIEW_COMPLETED' | 'EVENT_MERGED' | 'ALERT' | 'TASK_ASSIGNED' | 'MISSED_REPORT';
type UserRole = 'PUBLIC' | 'RESEARCHER' | 'EXPERT' | 'ADMIN';

function calcLevel(score: number): CredibilityLevel {
  if (score < 20) return 'VERY_LOW';
  if (score < 40) return 'LOW';
  if (score < 60) return 'MEDIUM';
  if (score < 80) return 'HIGH';
  return 'VERY_HIGH';
}

async function main() {
  console.log('🌱 开始填充种子数据...');

  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.subscription.deleteMany(),
    prisma.reviewComment.deleteMany(),
    prisma.reviewRequest.deleteMany(),
    prisma.task.deleteMany(),
    prisma.contribution.deleteMany(),
    prisma.analysis.deleteMany(),
    prisma.media.deleteMany(),
    prisma.duplicateReport.deleteMany(),
    prisma.eventCollaborator.deleteMany(),
    prisma.eventTag.deleteMany(),
    prisma.sightingTag.deleteMany(),
    prisma.event.deleteMany(),
    prisma.sighting.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  console.log('✅ 已清空现有数据');

  const hash = (pwd: string) => bcrypt.hashSync(pwd, 10);

  const users = await prisma.$transaction([
    prisma.user.create({
      data: {
        username: 'admin',
        email: 'admin@alien.sight',
        passwordHash: hash('Admin@123'),
        role: 'ADMIN' as UserRole,
        displayName: '系统管理员',
        bio: '系统超级管理员，负责全局审核与运维。',
        reputation: 999,
        contributionPoints: 5000,
      },
    }),
    prisma.user.create({
      data: {
        username: 'dr_zhang',
        email: 'zhang@research.ufo',
        passwordHash: hash('Expert@123'),
        role: 'EXPERT' as UserRole,
        displayName: '张博士',
        bio: '天体物理学博士，从事异常空中现象研究 15 年。',
        reputation: 850,
        contributionPoints: 3200,
      },
    }),
    prisma.user.create({
      data: {
        username: 'li_researcher',
        email: 'li@research.ufo',
        passwordHash: hash('Research@123'),
        role: 'RESEARCHER' as UserRole,
        displayName: '李研究员',
        bio: '心理学与社会学研究员，专注目击证词可信度分析。',
        reputation: 420,
        contributionPoints: 1100,
      },
    }),
    prisma.user.create({
      data: {
        username: 'night_sky_watcher',
        email: 'watcher@example.com',
        passwordHash: hash('User@123'),
        role: 'PUBLIC' as UserRole,
        displayName: '星空守望者',
        bio: '业余天文爱好者，深夜观星 10 年。',
        reputation: 68,
        contributionPoints: 340,
      },
    }),
    prisma.user.create({
      data: {
        username: 'beijing_observer',
        email: 'beijing@example.com',
        passwordHash: hash('User@123'),
        role: 'PUBLIC' as UserRole,
        displayName: '北京目击者',
        bio: '2019 年曾目击三角形飞行器。',
        reputation: 120,
        contributionPoints: 520,
      },
    }),
    prisma.user.create({
      data: {
        username: 'shanghai_stargazer',
        email: 'shanghai@example.com',
        passwordHash: hash('User@123'),
        role: 'PUBLIC' as UserRole,
        displayName: '上海观星人',
        bio: '记录城市夜空中的异常光亮现象。',
        reputation: 45,
        contributionPoints: 180,
      },
    }),
    prisma.user.create({
      data: {
        username: 'guangzhou_ufo_fan',
        email: 'gz@example.com',
        passwordHash: hash('User@123'),
        role: 'PUBLIC' as UserRole,
        displayName: '广州UFO迷',
        bio: '珠三角地区异常现象记录者。',
        reputation: 89,
        contributionPoints: 400,
      },
    }),
    prisma.user.create({
      data: {
        username: 'chengdu_sky',
        email: 'chengdu@example.com',
        passwordHash: hash('User@123'),
        role: 'PUBLIC' as UserRole,
        displayName: '蓉城夜行者',
        bio: '成都平原上空的光团观测者。',
        reputation: 56,
        contributionPoints: 260,
      },
    }),
  ]);

  const [admin, expert, researcher, user1, user2, user3, user4, user5] = users;
  console.log(`✅ 已创建 ${users.length} 位用户`);

  const sightingData = [
    {
      u: user1, title: '北京西北方上空出现碟形发光体',
      desc: '23:15 左右，在阳台观星时发现西北方向约 40 度仰角处出现一个淡蓝色碟形光体，悬停约 3 分钟后突然加速向西北方向消失。大小约为满月的 1/3，边缘有脉动光晕。',
      cat: 'DISC' as UfoCategory, lat: 39.9042, lon: 116.4074, loc: '北京市海淀区',
      when: new Date(Date.now() - 2 * 24 * 3600 * 1000), dur: 180, witnesses: 2, weather: '晴朗',
      score: 72, tier: 'public', status: 'VERIFIED' as SightingStatus, tags: ['碟形', '悬停', '光晕'],
    },
    {
      u: user2, title: '五环上空三角形黑影低空掠过',
      desc: '驾车沿北五环东行时，车辆正上方约 200 米高度有一巨大三角形黑色物体无声掠过。三边似乎有暗红色光点。当时速度不快，约 80km/h，持续可见约 40 秒。',
      cat: 'TRIANGLE' as UfoCategory, lat: 40.0132, lon: 116.3821, loc: '北京市朝阳区北五环',
      when: new Date(Date.now() - 5 * 24 * 3600 * 1000), dur: 40, witnesses: 1, weather: '多云',
      score: 55, tier: 'public', status: 'INVESTIGATING' as SightingStatus, tags: ['三角形', '低空', '无声'],
    },
    {
      u: user3, title: '浦东夜空出现橙色光球群',
      desc: '晚 21:50 左右，浦东东南方向出现 5-7 个橙色光球，呈 V 字队形缓慢移动。每个光球独立脉动，偶有分裂现象。总持续约 12 分钟，后逐个熄灭。',
      cat: 'ORB' as UfoCategory, lat: 31.2304, lon: 121.4737, loc: '上海市浦东新区',
      when: new Date(Date.now() - 1 * 24 * 3600 * 1000), dur: 720, witnesses: 4, weather: '晴朗少云',
      score: 81, tier: 'public', status: 'PENDING' as SightingStatus, tags: ['光球', '编队', '橙色'],
    },
    {
      u: user4, title: '白云山附近圆柱形物体垂直上升',
      desc: '清晨 5:40 爬白云山摩星岭时，东南方山谷上空发现银白色圆柱形物体，长约数百米，从约 500 米高度垂直缓慢上升至云层中消失。表面有规则纹理。',
      cat: 'CYLINDER' as UfoCategory, lat: 23.1815, lon: 113.2965, loc: '广州市白云山风景区',
      when: new Date(Date.now() - 7 * 24 * 3600 * 1000), dur: 240, witnesses: 3, weather: '薄雾',
      score: 68, tier: 'research', status: 'VERIFIED' as SightingStatus, tags: ['圆柱', '垂直', '银白色'],
    },
    {
      u: user5, title: '龙泉山高空强光爆闪',
      desc: '夜 00:23 分，龙泉山正西方向高空发生两次强烈白光爆闪，间隔约 5 秒。第一次爆闪后隐约可见红色光点悬浮 10 余秒。附近居民亦有报告。',
      cat: 'LIGHT' as UfoCategory, lat: 30.5535, lon: 104.0710, loc: '成都市龙泉驿区',
      when: new Date(Date.now() - 3 * 24 * 3600 * 1000), dur: 15, witnesses: 8, weather: '晴朗',
      score: 58, tier: 'public', status: 'PENDING' as SightingStatus, tags: ['爆闪', '强光', '高空'],
    },
    {
      u: user1, title: '同一区域再次出现碟形光体',
      desc: '与三天前同一方位、同一时间段，几乎完全相同的淡蓝色碟形光体再次出现，但持续时间仅约 45 秒，未做悬停，直接快速飞离。',
      cat: 'DISC' as UfoCategory, lat: 39.9050, lon: 116.4090, loc: '北京市海淀区',
      when: new Date(Date.now() - 0.5 * 24 * 3600 * 1000), dur: 45, witnesses: 3, weather: '晴朗',
      score: 60, tier: 'public', status: 'PENDING' as SightingStatus, tags: ['碟形', '重复目击'],
    },
    {
      u: researcher, title: '云南高海拔观测站拍摄到异常球体',
      desc: '高海拔射电观测站的自动光学监测系统捕捉到一个缓慢移动的球状物体，表面呈现金属质感反光。经初步分析排除气球、无人机等常规解释。本记录仅对研究级以上权限开放。',
      cat: 'SPHERE' as UfoCategory, lat: 25.0389, lon: 102.7183, loc: '云南省昆明市东川区观测站',
      when: new Date(Date.now() - 10 * 24 * 3600 * 1000), dur: 1800, witnesses: 2, weather: '极好',
      score: 88, tier: 'research', status: 'INVESTIGATING' as SightingStatus, tags: ['研究级', '球体', '射电站'],
    },
    {
      u: expert, title: '西北戈壁地区群体目击事件',
      desc: '某牧民村落多人目击多个不明飞行物体在夕阳下进行空中机动表演。运动轨迹非常规，有瞬间变速、90 度急转现象。专家级资料。',
      cat: 'OTHER' as UfoCategory, lat: 41.8612, lon: 93.3612, loc: '甘肃省酒泉市戈壁滩',
      when: new Date(Date.now() - 15 * 24 * 3600 * 1000), dur: 3600, witnesses: 15, weather: '晴朗干燥',
      score: 95, tier: 'expert', status: 'VERIFIED' as SightingStatus, tags: ['专家级', '群体目击', '机动'],
    },
    {
      u: user4, title: '珠江口海面上空发现不明光源',
      desc: '夜间乘船过珠江口，海平面上方约 10 米高度有一强光源，紧贴水面移动。光下似乎有大型物体轮廓，但无法辨识细节。约 5 分钟后潜水消失。',
      cat: 'LIGHT' as UfoCategory, lat: 22.1815, lon: 113.7000, loc: '珠江口海面',
      when: new Date(Date.now() - 8 * 24 * 3600 * 1000), dur: 300, witnesses: 6, weather: '海风，有云',
      score: 48, tier: 'public', status: 'PENDING' as SightingStatus, tags: ['海面', '低空', '潜水'],
    },
    {
      u: user5, title: '峨眉金顶球状闪电？',
      desc: '雷雨天气，在金顶附近看到云层中多个白色球体在雷暴云中跳跃移动，大小不规则，持续约 20 分钟。不确定是球状闪电还是其他现象。',
      cat: 'ORB' as UfoCategory, lat: 29.5224, lon: 103.3363, loc: '峨眉山金顶',
      when: new Date(Date.now() - 4 * 24 * 3600 * 1000), dur: 1200, witnesses: 11, weather: '雷暴',
      score: 32, tier: 'public', status: 'PENDING' as SightingStatus, tags: ['雷暴', '疑似球状闪电', '待复核'],
    },
    {
      u: user2, title: '通州夜空出现旋转光环',
      desc: '22:30 左右东部天空出现大直径旋转光环，外圈呈青蓝色，约 10 分钟后逐渐消散。已拍摄视频。',
      cat: 'LIGHT' as UfoCategory, lat: 39.9088, lon: 116.6568, loc: '北京市通州区',
      when: new Date(Date.now() - 2 * 24 * 3600 * 1000), dur: 600, witnesses: 5, weather: '晴',
      score: 64, tier: 'public', status: 'PENDING' as SightingStatus, tags: ['光环', '旋转', '视频'],
    },
    {
      u: user3, title: '崇明岛上空编队光点',
      desc: '凌晨 4 点左右，崇明岛东北方天空 10 余个光点组成菱形编队缓慢通过。亮度约 2 等星，无闪烁。',
      cat: 'LIGHT' as UfoCategory, lat: 31.6288, lon: 121.3998, loc: '上海市崇明区',
      when: new Date(Date.now() - 1 * 24 * 3600 * 1000), dur: 180, witnesses: 2, weather: '极佳',
      score: 50, tier: 'public', status: 'PENDING' as SightingStatus, tags: ['编队', '光点', '凌晨'],
    },
  ];

  const sightings = [];
  for (const s of sightingData) {
    const level = calcLevel(s.score);
    const sighting = await prisma.sighting.create({
      data: {
        userId: s.u.id,
        title: s.title,
        description: s.desc,
        category: s.cat,
        latitude: s.lat,
        longitude: s.lon,
        locationName: s.loc,
        occurredAt: s.when,
        durationSeconds: s.dur,
        witnessCount: s.witnesses,
        weatherConditions: s.weather,
        credibilityScore: s.score,
        credibilityLevel: level,
        contentTier: s.tier,
        status: s.status,
        isFalsePositive: s.score < 35,
        tags: { create: s.tags.map((t: string) => ({ tag: t })) },
      },
    });
    sightings.push(sighting);

    await prisma.contribution.create({
      data: { userId: s.u.id, sightingId: sighting.id, actionType: 'CREATE_SIGHTING', points: 50 },
    });
  }
  console.log(`✅ 已创建 ${sightings.length} 条观测记录`);

  const events = await prisma.$transaction([
    prisma.event.create({
      data: {
        title: '2024·夏 华北碟形光体系列目击',
        summary: '北京及周边地区连续多日出现碟形淡蓝色发光体，集中于西北方向，多份独立证词高度一致。',
        description: '近一周内在北京海淀、通州、河北香河等地出现多起类似描述的碟形发光体目击，特征高度一致：淡蓝色、边缘脉动光晕、悬停后快速飞离。',
        latitude: 39.95, longitude: 116.45,
        startedAt: new Date(Date.now() - 7 * 24 * 3600 * 1000),
        credibilityScore: 78,
        sightingCount: 3,
        isResearchTier: 'public',
        sightings: { connect: [{ id: sightings[0].id }, { id: sightings[1].id }, { id: sightings[5].id }] },
        collaborators: {
          create: [
            { userId: expert.id, role: 'lead_researcher' },
            { userId: researcher.id, role: 'analyst' },
            { userId: admin.id, role: 'reviewer' },
          ],
        },
        tags: { create: [{ tag: '华北系列' }, { tag: '碟形' }, { tag: '悬停' }] },
      },
    }),
    prisma.event.create({
      data: {
        title: '2024·春 长三角橙色光球事件簇',
        summary: '上海、杭州、苏州等长三角地区集中出现多个橙色光球编队目击，可能与高空放电现象有关。',
        latitude: 31.3, longitude: 121.4,
        startedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000),
        credibilityScore: 72,
        sightingCount: 2,
        isResearchTier: 'public',
        sightings: { connect: [{ id: sightings[2].id }, { id: sightings[11].id }] },
        collaborators: {
          create: [
            { userId: researcher.id, role: 'lead' },
            { userId: user3.id, role: 'witness_lead' },
          ],
        },
        tags: { create: [{ tag: '长三角' }, { tag: '光球' }, { tag: '编队' }] },
      },
    }),
    prisma.event.create({
      data: {
        title: '西北戈壁异常群体目击事件（研究级）',
        summary: '甘肃某戈壁村落群人目击高机动不明飞行物，细节仅对研究级以上权限开放。',
        latitude: 41.86, longitude: 93.36,
        startedAt: new Date(Date.now() - 15 * 24 * 3600 * 1000),
        credibilityScore: 95,
        sightingCount: 1,
        isResearchTier: 'research',
        sightings: { connect: [{ id: sightings[7].id }] },
        collaborators: {
          create: [
            { userId: expert.id, role: 'principal' },
            { userId: researcher.id, role: 'data' },
            { userId: admin.id, role: 'oversight' },
          ],
        },
        tags: { create: [{ tag: '研究级' }, { tag: '群体目击' }, { tag: '高机动' }] },
      },
    }),
  ]);
  console.log(`✅ 已创建 ${events.length} 个聚合事件`);

  await prisma.$transaction([
    prisma.analysis.create({
      data: {
        sightingId: sightings[0].id,
        userId: researcher.id,
        content: '从时间、位置、外形描述与持续时间来看，此次目击与近期华北地区同类报告高度吻合，排除常规飞行器。建议与 #1 报告并案处理。',
        confidence: 0.85,
        isResearch: false,
      },
    }),
    prisma.analysis.create({
      data: {
        sightingId: sightings[0].id,
        userId: expert.id,
        content: '【专家级分析】结合气象数据、航班数据排除已知现象。多证人证词一致，描述细节（脉动光晕、悬停姿态）重复性高，可信度高，疑似非常规飞行器。',
        confidence: 0.92,
        isResearch: true,
      },
    }),
    prisma.analysis.create({
      data: {
        sightingId: sightings[2].id,
        userId: researcher.id,
        content: '多个独立证人描述一致，橙色光球 V 字编队移动特征排除了无人机灯光表演（通常为固定图案）。建议复核卫星过境数据。',
        confidence: 0.7,
        isResearch: false,
      },
    }),
    prisma.analysis.create({
      data: {
        sightingId: sightings[3].id,
        userId: expert.id,
        content: '【研究级】白云山圆柱形目击：垂直上升、规则纹理特征排除常见解释。时间早、地点偏僻（少灯光污染）进一步提升可信度。',
        confidence: 0.78,
        isResearch: true,
      },
    }),
    prisma.analysis.create({
      data: {
        sightingId: sightings[7].id,
        userId: researcher.id,
        content: '15 名牧民独立证词高度一致，高机动飞行特征（瞬间变速、90 度急转）超出任何已知人造飞行器能力上限。本事件优先级极高。',
        confidence: 0.95,
        isResearch: true,
      },
    }),
  ]);
  console.log('✅ 已创建分析结论');

  await prisma.$transaction([
    prisma.duplicateReport.create({
      data: {
        sourceSightingId: sightings[0].id,
        duplicateSightingId: sightings[5].id,
        similarityScore: 0.91,
        reportedBy: user2.id,
        resolved: true, merged: true, reviewedBy: expert.id,
      },
    }),
    prisma.duplicateReport.create({
      data: {
        sourceSightingId: sightings[2].id,
        duplicateSightingId: sightings[11].id,
        similarityScore: 0.72,
        reportedBy: user4.id,
        resolved: false, merged: false,
      },
    }),
  ]);

  const [rv1, rv2] = await prisma.$transaction([
    prisma.reviewRequest.create({
      data: {
        sightingId: sightings[7].id,
        requesterId: researcher.id,
        reviewerId: expert.id,
        status: 'VERIFIED' as SightingStatus,
        priority: 'urgent',
        notes: '群体目击，证人众多，急待专家复核确认。',
        assignedAt: new Date(Date.now() - 14 * 24 * 3600 * 1000),
        completedAt: new Date(Date.now() - 13 * 24 * 3600 * 1000),
      },
    }),
    prisma.reviewRequest.create({
      data: {
        sightingId: sightings[4].id,
        requesterId: user5.id,
        reviewerId: researcher.id,
        status: 'PENDING' as SightingStatus,
        priority: 'normal',
        notes: '多次目击爆闪，需专家意见是否与球状闪电区分。',
      },
    }),
  ]);

  await prisma.reviewComment.create({
    data: {
      reviewRequestId: rv1.id,
      userId: expert.id,
      content: '已全面审查 15 份独立证词与轨迹比对，结论：本事件具备极高研究价值，标记为 VERIFIED。细节已归档至研究级数据库。',
      recommendation: 'VERIFY',
    },
  });
  console.log('✅ 已创建复核申请与意见');

  await prisma.$transaction([
    prisma.task.create({
      data: {
        title: '收集华北事件更多物证（照片、视频）',
        description: '在各社交平台与目击社区主动联系华北碟形目击事件潜在证人，收集原始照片与视频证据归档。',
        eventId: events[0].id,
        creatorId: expert.id,
        assigneeId: researcher.id,
        status: 'IN_PROGRESS' as TaskStatus,
        priority: 'high',
        dueDate: new Date(Date.now() + 10 * 24 * 3600 * 1000),
      },
    }),
    prisma.task.create({
      data: {
        title: '比对当日航班与卫星过境数据',
        description: '从民航数据与卫星星历中排查长三角橙色光球事件当日是否存在常规解释候选。',
        eventId: events[1].id,
        creatorId: researcher.id,
        assigneeId: expert.id,
        status: 'OPEN' as TaskStatus,
        priority: 'medium',
      },
    }),
    prisma.task.create({
      data: {
        title: '联系戈壁目击证人进行结构化访谈',
        description: '设计结构化访谈问卷，安排视频会议完成 15 名证人的一对一深度访谈。',
        eventId: events[2].id,
        creatorId: admin.id,
        assigneeId: expert.id,
        status: 'COMPLETED' as TaskStatus,
        priority: 'urgent',
        completedAt: new Date(Date.now() - 12 * 24 * 3600 * 1000),
      },
    }),
    prisma.task.create({
      data: {
        title: '现场踏勘峨眉山目击区域',
        description: '前往峨眉山金顶附近，结合气象站数据判断球状闪电发生条件。',
        sightingId: sightings[9].id,
        creatorId: researcher.id,
        assigneeId: user5.id,
        status: 'OPEN' as TaskStatus,
        priority: 'low',
      },
    }),
  ]);
  console.log('✅ 已创建协作任务');

  await prisma.$transaction([
    prisma.subscription.create({
      data: {
        userId: user1.id, type: 'region',
        latitude: 39.9042, longitude: 116.4074, radiusKm: 100,
        regionName: '北京及周边', minCredibility: 40,
      },
    }),
    prisma.subscription.create({
      data: {
        userId: user2.id, type: 'region',
        latitude: 39.9088, longitude: 116.6568, radiusKm: 150,
        regionName: '京津冀', minCredibility: 30,
      },
    }),
    prisma.subscription.create({
      data: {
        userId: user3.id, type: 'region',
        latitude: 31.2304, longitude: 121.4737, radiusKm: 200,
        regionName: '长三角', minCredibility: 20,
      },
    }),
    prisma.subscription.create({
      data: { userId: researcher.id, type: 'research', minCredibility: 50 },
    }),
    prisma.subscription.create({
      data: { userId: expert.id, type: 'general', minCredibility: 0 },
    }),
  ]);
  console.log('✅ 已创建订阅');

  await prisma.notification.createMany({
    data: [
      {
        userId: researcher.id, type: 'REVIEW_REQUESTED' as NotificationType,
        title: '收到专家复核申请', message: '成都龙泉山强光爆闪事件需要您的复核意见。',
        relatedSightingId: sightings[4].id,
      },
      {
        userId: expert.id, type: 'NEW_SIGHTING' as NotificationType,
        title: '研究级新线索', message: '云南高海拔观测站有新的球体记录。',
        relatedSightingId: sightings[6].id, isRead: true,
      },
      {
        userId: user1.id, type: 'EVENT_MERGED' as NotificationType,
        title: '您的报告已被合并到事件',
        message: '专家已将您提交的观测记录合并到事件：2024·夏 华北碟形光体系列目击。',
        relatedEventId: events[0].id,
      },
      {
        userId: user2.id, type: 'ALERT' as NotificationType,
        title: '区域预警：新的观测线索', message: '北京通州区有新的目击报告：通州夜空出现旋转光环。',
        relatedSightingId: sightings[10].id,
      },
      {
        userId: user5.id, type: 'TASK_ASSIGNED' as NotificationType,
        title: '新任务已分配给您', message: '现场踏勘峨眉山目击区域。',
        relatedSightingId: sightings[9].id,
      },
    ],
  });
  console.log('✅ 已创建示例通知');

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                🎉 种子数据填充完毕！                           ║
╠══════════════════════════════════════════════════════════════╣
║  👤 用户: ${users.length} 位 (admin/专家/研究员/5 位公开用户)               ║
║  👽 观测记录: ${sightings.length} 条 (公开/研究/专家三级内容)         ║
║  🎯 聚合事件: ${events.length} 个                                             ║
║  🔍 分析结论: 5 条                                           ║
║  📋 复核申请: 2 个 + 评论                                       ║
║  👥 协作任务: 4 个 (含不同状态)                                ║
║  🔔 通知订阅: 5 订阅 + 5 通知                                  ║
╠══════════════════════════════════════════════════════════════╣
║  🔐 测试账号:                                                  ║
║    admin / Admin@123      (管理员)                              ║
║    dr_zhang / Expert@123  (专家)                                ║
║    li_researcher / Research@123  (研究员)                       ║
║    night_sky_watcher / User@123    (公开用户)                   ║
╚══════════════════════════════════════════════════════════════╝
`);
}

main()
  .catch((e) => {
    console.error('❌ 种子数据填充失败:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
