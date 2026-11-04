# v17 학습 표현 대조: 정방향 view0 대 네 방향 평균

v12 학습 head는 사람이 강아지로 읽은 울산 dog-4를 chair로 분류했다. 그림의 정방향이 확보되어 있는데4회전 평균으로 방향별 의미 단서가 약해지는지 검증한다. 이1사례가 가설의 동기인 개발 자료임을 명시한다. 사람 인식 일반화 또는 새로운 독립 test라고 하지 않는다.

## 학습과 고정 자료

v12-dataset의 dataset.json/기존features.npz/metadata/road-features.npz/roads.json을 그대로 쓴다.2304개·train1646/val316/test342,24추천+8일반경쟁32범주다. 새 원본·증강·label·feature추출은 없다. 로켓3요청은 미지원으로75분모에 남긴다. 학습 함수는 기존 balanced ridge/prototype이며 λ .01/.1/1/10,검증macro 최고·동률 큰λ와val genericFAR<=.10 margin규칙을 그대로 사용한다. 사람/도로AI 판정은 학습·λ·margin 선택에 쓰지 않는다.

A는 동결v12 mean4 학습weights와정규화된4뷰평균 입력, B는 같은4view캐시의 view0만으로새로학습한weights와 view0입력이다. handdrawn view0은 수집정방향,road view0은 −generatorPlacement.rotDeg 정렬이다. 도로에는생성배치가있다는전제를쓰며 임의north-up도로의일반능력으로확대하지않는다.4뷰배열과실제per-view점수는보존하되 분류에어느입력을썼는지명시한다. shape/scoring/encoder/cache는변경하지않는다.

## 도로 비교와 판정

두 방식 모두 표시방향을 canonical view0으로 고정한다. A의기존 per-view최대표시로비교하지않으므로 분류표현효과와표시효과를섞지않는다. 기존1003원본후보·25종×3지역75요청·동일intent matching/margin최대선택·ID동률·보류를 유지한다. 원본좌표·노드/간선·3–8km·반복<=.2·영역은바꾸지않는다. 새로운generation이나geometry수정은없다. A의선택은v13의17/75추천·명확7/75와동일함을검사한다.

개발도로기준은기존첫후보8/75보다>=5조건증가(>=13/75),동물3종·사물3종이각각2지역이상명확,유효성100%와75분모보존이다.기존primary와다수결·각평가자원본을분리한다. primary실패를다수결성공으로바꾸지않는다.충족해도개발성능이며최종독립사람검증이남는다. 인간확인dog-4의재분류/선택은개발sanitycheck일뿐이며,이를제외한74요청의수치도기록한다.

보조 손그림 진단은 B head의testmacro가A head보다2%p이상하락하지않고genericFAR가증가하지않는지다. 이진단으로도로성과를대신하지않는다. B head와B prototype은보조로비교하며성공방식을사후선택하지않는다. 주도로비교는A mean4 head와B canonical0 head다.

기존도일pixel판정은bridge로재사용하며새로운중립이미지만동일3AI에게이름/방법/참고/점수를숨겨자유명명한다. source·checkpoint·features·catalog·reviewfingerprint를고정하고누락/중복을거절한다. 실패하면같은case를맞히도록threshold/표본/정답을조정하지않는다. 기존12조건·점수식·holdout-v2·앱기본을유지한다.

실행 전 판정 층 명시: >=13/75·동물3종/사물3종각2지역은3AI다수결의개발보조기준이다. 기존primary의주지지기준은A대비명확요청>=5증가,그중동물>=3요청·최소2종으로별도평가한다. 두층모두기록하고어느한층의실패를다른층으로대체하지않는다. 이AI기준과독립실제사람검증은별개다. 현재사람확인1사례만으로최종목표를완료하지않는다.
